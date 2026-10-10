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
const isOriginAllowed = require('./lib/origin');
const createMetrics = require('./lib/metrics');
const createReadLimiter = require('./lib/read_limiter');
const { commandSources } = require('./lib/sources');
const pkg = require('./package.json');

/**
 * Parse args
 */
const program = parseOptions(process.argv);

// Validates --journal-unit / --ssh up front, with a readable message.
let extraSources;
try {
  extraSources = commandSources(program, 0);
} catch (e) {
  console.error(e.message);
  process.exit(1);
}

if (
  program.args.length === 0 &&
  program.container.length === 0 &&
  extraSources.length === 0
) {
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
const files = []
  .concat(program.args)
  .concat(program.container)
  .concat(extraSources.map((src) => src.name))
  .join(' ');
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
  const metrics = createMetrics(pkg.version);
  const readLimiter = createReadLimiter();
  if (program.metrics) {
    appBuilder.metrics(metrics);
  }
  appBuilder
    .static(path.join(__dirname, 'web', 'assets'))
    .download(
      program.args.map((f) => path.resolve(f)),
      {
        containers: program.container,
        engine: program.containerEngine,
        // resolved lazily: the tailer is created after the HTTP app
        commands: () => tailer.getReadCommands().filter((c) => c.type !== 'container'),
      }
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
  const io = new Server({
    path: `${urlPath}/socket.io`,
    allowRequest: (req, callback) => {
      callback(
        null,
        isOriginAllowed(
          req.headers.origin,
          req.headers.host,
          program.allowedOrigin
        )
      );
    },
  });
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
      highlightConfig = JSON.parse(fs.readFileSync(presetPath, 'utf8'));
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
      colorsPreset = JSON.parse(fs.readFileSync(colorsPresetPath, 'utf8'));
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
    journal: program.journal,
    journalUnit: program.journalUnit,
    ssh: program.ssh,
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

    // These flags are plain booleans (unset unless passed). Commander < 4
    // treated any "-no-" flag as a negation defaulting to true, which the
    // old inverted checks relied on.
    if (program.uiNoIndent) {
      socket.emit('options:no-indent');
    }

    if (program.uiNoColors) {
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
      isContainer: tailer.getSources().some((src) => src.type !== 'file'),
    });

    tailer.getBuffer().forEach((line) => {
      socket.emit('line', line);
    });

    tailer.getErrors().forEach((err) => {
      socket.emit('line', { t: `[frontail] ${  (err.source || err.container)  }: ${  err.message}`, s: null });
    });

    // Client requests full file/container logs from beginning
    // Reads started by this socket; cancelled on disconnect so a client that
    // goes away mid-download doesn't leave a child process or file stream.
    const activeReads = new Set();
    const startRead = (fileIndex) => {
      // A new request replaces this socket's previous read (e.g. the user
      // switched source), so one client can never hold more than one.
      activeReads.forEach((stop) => stop());
      activeReads.clear();

      const release = readLimiter.acquire();
      if (!release) {
        socket.emit('line', {
          t: '[frontail] too many full-log reads in progress, try again in a moment',
          s: null,
        });
        socket.emit('read-end');
        return;
      }

      const cancel = tailer.readFromStart(
        fileIndex,
        (line) => socket.emit('line', line),
        () => {
          activeReads.delete(stop);
          release();
          socket.emit('read-end');
        }
      );
      const stop = () => {
        release();
        cancel();
      };
      activeReads.add(stop);
    };
    socket.on('disconnect', () => {
      activeReads.forEach((stop) => stop());
      activeReads.clear();
    });

    socket.on('read-from-start', (data) => {
      // fileIndex indexes the sources list sent in options:sources
      const fileIndex = (data && data.fileIndex) || 0;
      const force     = !!(data && data.force);
      const source = tailer.getSources()[fileIndex];
      if (!source) return;

      if (source.type !== 'file') {
        // Containers, journal and ssh: size isn't known up front, just stream it
        socket.emit('file-start-info', { size: 0, tooLarge: false, isContainer: true });
        startRead(fileIndex);
        return;
      }

      const filePath = source.name;

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
    metrics.countLine(line.s);
    filesSocket.emit('line', line);
  });

  metrics.gauge(
    'frontail_connected_clients',
    'Browsers currently connected to the log socket.',
    () => filesIo.sockets.size
  );
  metrics.gauge(
    'frontail_active_reads',
    'Full-log reads in progress (read from beginning).',
    () => readLimiter.active
  );
  metrics.gauge(
    'frontail_sources',
    'Number of log sources (files and containers).',
    () => tailer.getSources().length
  );

  tailer.on('error', (err) => {
    metrics.countError();
    filesSocket.emit('line', `[frontail] ${  (err.source || err.container)  }: ${  err.message}`);
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
