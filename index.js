'use strict';

const parseOptions = require('./lib/options_parser');
const daemonize = require('./lib/daemonize');
const { resolveSettings, start } = require('./lib/frontail');

const program = parseOptions(process.argv);

// Validates --journal-unit / --ssh up front, with a readable message.
let settings;
try {
  settings = resolveSettings(program);
} catch (e) {
  console.error(e.message);
  process.exit(1);
}

if (
  program.args.length === 0 &&
  program.container.length === 0 &&
  settings.extraSources.length === 0
) {
  console.error('Arguments needed, use --help');
  process.exit();
}

if (program.daemonize) {
  daemonize(__filename, program, {
    credentials: settings.credentials,
    doAuthorization: settings.doAuthorization,
    doSecure: settings.doSecure,
  });
} else {
  const app = start(program, settings);

  // Stop accepting connections and let sockets drain; force-quit if
  // something (e.g. a stuck client) keeps the process alive.
  const cleanExit = () => {
    setTimeout(() => process.exit(), 5000).unref();
    app.close(() => process.exit());
  };
  process.on('SIGINT', cleanExit);
  process.on('SIGTERM', cleanExit);
}
