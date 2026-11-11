'use strict';

const crypto = require('crypto');
const path = require('path');
const expressSession = require('express-session');
const { Server } = require('socket.io');
const tail = require('./tail');
const connectBuilder = require('./connect_builder');
const serverBuilder = require('./server_builder');
const resolveCredentials = require('./credentials');
const isOriginAllowed = require('./origin');
const createMetrics = require('./metrics');
const createReadLimiter = require('./read_limiter');
const createSessionAuth = require('./session_auth');
const { attachLogSocket, errorText } = require('./log_socket');
const { commandSources } = require('./sources');
const { loadHighlightPreset, loadColorsPreset } = require('./presets');
const pkg = require('../package.json');
const { expandLogDirs, buildDirView } = require('./log_dirs');

const ROOT = path.join(__dirname, '..');

/**
 * Everything derived from the parsed options that more than one step needs
 * (the daemon launcher and the server). Throws on invalid --journal-unit /
 * --ssh values.
 *
 * @param {import('./options_parser').Options} program
 */
function resolveSettings(program) {
  const extraSources = commandSources(program, 0);
  const { files: expandedDirFiles, skipped: dirSkipped } = expandLogDirs(program.dir, {
    maxDepth: program.dirMaxDepth,
    maxFiles: program.dirMaxFiles,
  });
  // A file listed explicitly must not be tailed twice when its directory is
  // connected as well, so the directory only contributes what is still missing.
  const dirFiles = expandedDirFiles.filter((file) => program.args.indexOf(file) === -1);
  const fileSources = program.args.concat(dirFiles);
  const credentials = resolveCredentials(program);
  const files = []
    .concat(fileSources)
    .concat(program.container)
    .concat(extraSources.map((src) => src.name))
    .join(' ');

  return {
    extraSources,
    dirFiles,
    dirSkipped,
    logDirs: buildDirView(program.dir, fileSources),
    credentials,
    doAuthorization: !!(credentials.user && credentials.password),
    doSecure: !!(program.key && program.certificate),
    urlPath: program.urlPath.replace(/\/$/, ''), // remove trailing slash
    files,
    filesNamespace: crypto.createHash('md5').update(files).digest('hex'),
  };
}

/**
 * Builds and starts the server: HTTP(S) app, socket.io, the tailer and the
 * log socket.
 *
 * @param {import('./options_parser').Options} program
 * @param {ReturnType<typeof resolveSettings>} [settings]
 * @returns {{
 *   server: import('http').Server,
 *   io: import('socket.io').Server,
 *   tailer: ReturnType<typeof tail>,
 *   metrics: ReturnType<typeof createMetrics>,
 *   close: (callback?: () => void) => void
 * }}
 */
function start(program, settings = resolveSettings(program)) {
  const {
    credentials,
    doAuthorization,
    doSecure,
    urlPath,
    files,
    filesNamespace,
    dirFiles = [],
  } = settings;

  const sessionSecret = crypto.randomBytes(32).toString('hex');
  const sessionStore = new expressSession.MemoryStore();
  const metrics = createMetrics(pkg.version);
  const readLimiter = createReadLimiter();

  /**
   * HTTP(s) server
   */
  const appBuilder = connectBuilder(urlPath).health().securityHeaders();
  if (doAuthorization) {
    appBuilder.session(sessionSecret, doSecure, sessionStore);
    // Sign-in page instead of the browser's Basic Auth dialog; the session
    // stays the source of truth for the UI and for the log socket.
    appBuilder.login(credentials.user, credentials.password);
  }
  if (program.metrics) {
    appBuilder.metrics(metrics);
  }
  // Files found under --dir are sources the browser can read, so the download
  // endpoints have to know them too. They are listed after the argv files,
  // the same order the tailer and the UI count them in.
  const filePaths = program.args
    .map((f) => path.resolve(f))
    .concat(dirFiles);

  appBuilder
    .static(path.join(ROOT, 'web', 'assets'))
    .download(
      filePaths,
      {
        containers: program.container,
        engine: program.containerEngine,
        commands: () =>
          tailer.getReadCommands().filter((c) => c.type !== 'container'),
      }
    )
    .index(
      path.join(ROOT, 'web', 'index.html'),
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
   * socket.io
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

  // socket.io middleware is per namespace: guard "/" and the log namespace.
  const requireSession = doAuthorization
    ? createSessionAuth(sessionSecret, sessionStore)
    : undefined;
  if (requireSession) {
    io.use(requireSession);
  }

  const presets = {
    highlightConfig: loadHighlightPreset(program, path.join(ROOT, 'preset')),
    colorsPreset: loadColorsPreset(program),
  };

  // The HTTP app above only touches `tailer` lazily (per request), so it can
  // be created after it.
  const tailer = tail(program.args.concat(dirFiles), {
    buffer: program.number,
    container: program.container,
    containerEngine: program.containerEngine,
    journal: program.journal,
    journalUnit: program.journalUnit,
    ssh: program.ssh,
  });

  const logSocket = attachLogSocket({
    io,
    namespace: filesNamespace,
    tailer,
    options: program,
    logDirs: settings.logDirs || [],
    presets,
    version: pkg.version,
    readLimiter,
    requireSession,
    // Re-walk the configured directories on demand: the listing is a
    // snapshot, and a log file created after startup only becomes visible
    // when the browser asks for a fresh one.
    onRefreshLogDirs:
      program.dir && program.dir.length > 0
        ? () => {
            const expanded = expandLogDirs(program.dir, {
              maxDepth: program.dirMaxDepth,
              maxFiles: program.dirMaxFiles,
            });
            const dirOnly = expanded.files.filter(
              (f) => program.args.indexOf(f) === -1
            );
            return {
              logDirs: buildDirView(program.dir, program.args.concat(dirOnly)),
              files: dirOnly.length,
            };
          }
        : null,
  });

  tailer.on('line', (line) => {
    metrics.countLine(line.s);
    logSocket.emit('line', line);
  });
  tailer.on('error', (err) => {
    metrics.countError();
    logSocket.emit('line', errorText(err));
  });

  metrics.gauge(
    'frontail_connected_clients',
    'Browsers currently connected to the log socket.',
    () => logSocket.sockets.size
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

  return {
    server,
    io,
    tailer,
    metrics,
    /** Stops tailing and closes the server (io.close also closes `server`). */
    close(callback) {
      tailer.close();
      io.close(callback);
    },
  };
}

module.exports = { resolveSettings, start };
