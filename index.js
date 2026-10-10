'use strict';

const { parseCookie } = require('cookie');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');
const path = require('path');
const { Server } = require('socket.io');
const fs = require('fs');
const untildify = require('./lib/untildify');
const tail = require('./lib/tail');
const connectBuilder = require('./lib/connect_builder');
const parseOptions = require('./lib/options_parser');
const serverBuilder = require('./lib/server_builder');
const daemonize = require('./lib/daemonize');
const resolveCredentials = require('./lib/credentials');
const pkg = require('./package.json');

/**
 * Parse args
 */
const program = parseOptions(process.argv);
if (program.args.length === 0 && program.container.length === 0) {
  console.error('Arguments needed, use --help');
  process.exit();
}

/**
 * Validate params
 */
const credentials = resolveCredentials(program);
const doAuthorization = !!(credentials.user && credentials.password);
const doSecure = !!(program.key && program.certificate);
const sessionSecret = crypto.randomBytes(32).toString('hex');
const files = [].concat(program.args).concat(program.container).join(' ');
const filesNamespace = crypto.createHash('md5').update(files).digest('hex');
const urlPath = program.urlPath.replace(/\/$/, ''); // remove trailing slash

if (program.daemonize) {
  daemonize(__filename, program, {
    credentials,
    doAuthorization,
    doSecure,
  });
} else {
  /**
   * HTTP(s) server setup
   */
  const appBuilder = connectBuilder(urlPath).health().securityHeaders();
  if (doAuthorization) {
    appBuilder.session(sessionSecret, doSecure);
    appBuilder.authorize(credentials.user, credentials.password);
  }
  appBuilder
    .static(path.join(__dirname, 'web', 'assets'))
    .download(
      program.args.map((f) => path.resolve(f)),
      { containers: program.container, engine: program.containerEngine }
    )
    .index(
      path.join(__dirname, 'web', 'index.html'),
      files,
      filesNamespace,
      program.theme,
      pkg.version
    );

  const builder = serverBuilder();
  if (doSecure) {
    builder.secure(program.key, program.certificate);
  }
  const server = builder
    .use(appBuilder.build())
    .port(program.port)
    .host(program.host)
    .build();

  /**
   * socket.io setup
   */
  const io = new Server({ path: `${urlPath}/socket.io` });
  io.attach(server);

  // socket.io middleware registered on `io` only guards the main "/"
  // namespace, so it must also be applied to the log namespace below.
  const requireSession = (socket, next) => {
    const handshakeData = socket.request;
    if (handshakeData.headers.cookie) {
      const cookies = parseCookie(handshakeData.headers.cookie);
      const sessionIdEncoded = cookies['connect.sid'];
      if (!sessionIdEncoded) {
        return next(new Error('Session cookie not provided'), false);
      }
      const sessionId = cookieParser.signedCookie(
        sessionIdEncoded,
        sessionSecret
      );
      if (sessionId) {
        return next(null);
      }
      return next(new Error('Invalid cookie'), false);
    }

    return next(new Error('No cookie in header'), false);
  };

  if (doAuthorization) {
    io.use(requireSession);
  }

  /**
   * Setup UI highlights
   */
  let highlightConfig;
  if (program.uiHighlight) {
    let presetPath;

    if (!program.uiHighlightPreset) {
      presetPath = path.join(__dirname, 'preset', 'default.json');
    } else {
      presetPath = path.resolve(untildify(program.uiHighlightPreset));
    }

    if (fs.existsSync(presetPath)) {
      highlightConfig = JSON.parse(fs.readFileSync(presetPath));
    } else {
      throw new Error(`Preset file ${presetPath} doesn't exists`);
    }
  }

  /**
   * Setup extra log colorizing rules
   */
  let colorsPreset;
  if (program.uiColorsPreset) {
    const colorsPresetPath = path.resolve(untildify(program.uiColorsPreset));
    if (fs.existsSync(colorsPresetPath)) {
      colorsPreset = JSON.parse(fs.readFileSync(colorsPresetPath));
    } else {
      throw new Error(`Colors preset file ${colorsPresetPath} doesn't exists`);
    }
  }

  /**
   * When connected send starting data
   */
  const tailer = tail(program.args, {
    buffer: program.number,
    container: program.container,
    containerEngine: program.containerEngine,
  });

  // File-size threshold for warning (50 MB)
  const FILE_SIZE_WARNING_BYTES = 50 * 1024 * 1024;

  const filesIo = io.of(`/${filesNamespace}`);
  if (doAuthorization) {
    filesIo.use(requireSession);
  }

  const filesSocket = filesIo.on('connection', (socket) => {
    socket.emit('options:lines', program.lines);
    socket.emit('options:version', pkg.version);

    if (program.uiHideTopbar) {
      socket.emit('options:hide-topbar');
    }

    if (!program.uiNoIndent) {
      socket.emit('options:no-indent');
    }

    if (!program.uiNoColors) {
      socket.emit('options:no-colors');
    }

    if (program.uiHighlight) {
      socket.emit('options:highlightConfig', highlightConfig);
    }

    if (colorsPreset) {
      socket.emit('options:colorsPreset', colorsPreset);
    }

    socket.emit('options:sources', tailer.getSources());

    socket.emit('options:source-info', {
      isContainer: !!(program.container && program.container.length > 0),
    });

    tailer.getBuffer().forEach((line) => {
      socket.emit('line', line);
    });

    tailer.getErrors().forEach((err) => {
      socket.emit('line', { t: `[frontail] ${  err.container  }: ${  err.message}`, s: null });
    });

    // Client requests full file/container logs from beginning
    // Reads started by this socket; cancelled on disconnect so a client that
    // goes away mid-download doesn't leave a child process or file stream.
    const activeReads = new Set();
    const startRead = (fileIndex) => {
      const cancel = tailer.readFromStart(
        fileIndex,
        (line) => socket.emit('line', line),
        () => {
          activeReads.delete(cancel);
          socket.emit('read-end');
        }
      );
      activeReads.add(cancel);
    };
    socket.on('disconnect', () => {
      activeReads.forEach((cancel) => cancel());
      activeReads.clear();
    });

    socket.on('read-from-start', (data) => {
      const fileIndex = (data && data.fileIndex) || 0;
      const force     = !!(data && data.force);
      const isContainer = !!(program.container && program.container.length > 0);

      if (isContainer) {
        // For containers we don't easily know size/tooLarge beforehand without extra commands
        // We'll just stream it
        socket.emit('file-start-info', { size: 0, tooLarge: false, isContainer: true });
        startRead(fileIndex);
        return;
      }

      const filePath  = program.args[fileIndex];
      if (!filePath) return;

      let stat;
      try { stat = fs.statSync(filePath); } catch { return; }

      const tooLarge = stat.size > FILE_SIZE_WARNING_BYTES;

      // Always inform client of size; tooLarge flag only set when NOT forcing
      socket.emit('file-start-info', { size: stat.size, tooLarge: tooLarge && !force });

      if (tooLarge && !force) return; // client will show warning / download prompt

      // Stream the whole file line by line back to this socket only
      startRead(fileIndex);
    });
  });

  /**
   * Send incoming data
   */
  tailer.on('line', (line) => {
    filesSocket.emit('line', line);
  });

  tailer.on('error', (err) => {
    filesSocket.emit('line', `[frontail] ${  err.container  }: ${  err.message}`);
  });

  /**
   * Handle signals
   */
  const cleanExit = () => {
    tailer.close();
    // Stop accepting connections and let sockets drain; force-quit if
    // something (e.g. a stuck client) keeps the process alive.
    setTimeout(() => process.exit(), 5000).unref();
    io.close(() => process.exit());
  };
  process.on('SIGINT', cleanExit);
  process.on('SIGTERM', cleanExit);
}
