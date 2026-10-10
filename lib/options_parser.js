const fs = require('fs');
const path = require('path');
const untildify = require('./untildify');
const { Command } = require('commander');
const pkg = require('../package.json');

/**
 * Parse argv into a plain options object (plus `args`, the positional
 * files). A fresh Command per call keeps parses independent of each other.
 */
module.exports = (argv) => {
  const program = new Command();

  program
    .version(pkg.version)
    .usage('[options] [file ...]')
    .argument('[file...]', 'log files to tail')
    .helpOption('--help')
    .option(
      '-h, --host <host>',
      'listening host, default 0.0.0.0',
      String,
      '0.0.0.0',
    )
    .option('-p, --port <port>', 'listening port, default 9001', Number, 9001)
    .option(
      '-n, --number <number>',
      'starting lines number, default 10',
      Number,
      10,
    )
    .option(
      '-l, --lines <lines>',
      'number on lines stored in browser, default 2000',
      Number,
      2000,
    )
    .option(
      '-t, --theme <theme>',
      'name of the theme (default, dark)',
      String,
      'default',
    )
    .option('-d, --daemonize', 'run as daemon')
    .option(
      '-U, --user <username>',
      'Basic Authentication username (or FRONTAIL_USER env), option works only along with -P option',
      String,
      false,
    )
    .option(
      '-P, --password <password>',
      'Basic Authentication password (or FRONTAIL_PASSWORD env), option works only along with -U option; prefer --password-file, argv is visible in ps',
      String,
      false,
    )
    .option(
      '--password-file <path>',
      'read the Basic Authentication password from a file (e.g. a Docker/k8s secret)',
      String,
      false,
    )
    .option(
      '-k, --key <key.pem>',
      'Private Key for HTTPS, option works only along with -c option',
      String,
      false,
    )
    .option(
      '-c, --certificate <cert.pem>',
      'Certificate for HTTPS, option works only along with -k option',
      String,
      false,
    )
    .option(
      '--pid-path <path>',
      'if run as daemon file that will store the process id, default /var/run/frontail.pid',
      String,
      '/var/run/frontail.pid',
    )
    .option(
      '--log-path <path>',
      'if run as daemon file that will be used as a log, default /dev/null',
      String,
      '/dev/null',
    )
    .option(
      '-C, --container <container>',
      'container name or id',
      (val, memo) => {
        memo.push(val);
        return memo;
      },
      [],
    )
    .option(
      '--journal',
      'follow the systemd journal (journalctl); the way to get "syslog" on systems without /var/log/syslog',
    )
    .option(
      '--journal-unit <unit>',
      'follow only this systemd unit (repeatable, implies --journal)',
      (val, memo) => {
        memo.push(val);
        return memo;
      },
      [],
    )
    .option(
      '--ssh <target>',
      'follow a remote file over ssh: [user@]host:/absolute/path (repeatable; key-based auth, no prompts)',
      (val, memo) => {
        memo.push(val);
        return memo;
      },
      [],
    )
    .option(
      '--allowed-origin <origin>',
      'extra browser origin allowed to open the socket (repeatable, e.g. https://logs.example.com); by default only same-host origins are accepted',
      (val, memo) => {
        memo.push(val);
        return memo;
      },
      [],
    )
    .option(
      '--container-engine <engine>',
      'container engine (docker, podman), default docker',
      String,
      'docker',
    )
    .option(
      '--url-path <path>',
      'URL path for the browser application, default /',
      String,
      '/',
    )
    .option(
      '--metrics',
      'expose Prometheus metrics at <url-path>/metrics (behind Basic Auth when enabled)',
    )
    .option('--ui-hide-topbar', 'hide topbar (log file name and search box)')
    .option('--ui-no-indent', "don't indent log lines")
    .option(
      '--ui-highlight',
      'highlight words or lines if defined string found in logs, default preset',
    )
    .option(
      '--ui-highlight-preset <path>',
      'custom preset for highlighting (see ./preset/default.json)',
    )
    .option(
      '--ui-no-colors',
      'disable log colorizing (ANSI colors + apache/nginx/tomcat/syslog format autodetection), default enabled',
    )
    .option(
      '--ui-colors-preset <path>',
      'custom preset of extra log format colorizing rules (see ./preset/colors-example.json)',
    )
    .option(
      '--config <path>',
      'JSON config file; keys are option names (camelCase or kebab-case) plus an optional "files" array. Command line flags win over the file',
    )
    .option(
      '--disable-usage-stats',
      'deprecated, no-op: usage statistics were removed',
    )
    .addHelpText(
      'after',
      `
Author:  Houssem Ben Ali
Website: https://github.com/hbenali/frontail
Contact: contact@hbenali.ovh`,
    );

  program.parse(argv);

  const opts = program.opts();
  let { args } = program;

  if (opts.config) {
    const file = path.resolve(untildify(opts.config));
    let config;
    try {
      config = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) {
      throw new Error(`Cannot read config file ${file}: ${e.message}`, {
        cause: e,
      });
    }

    const camel = (key) => key.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    const known = new Map(program.options.map((o) => [o.attributeName(), o]));

    Object.keys(config).forEach((rawKey) => {
      if (rawKey === 'files') return;
      const key = camel(rawKey);
      if (key === 'config' || !known.has(key)) {
        throw new Error(`Unknown option "${rawKey}" in config file ${file}`);
      }
      // Only fill in what the command line left at its default.
      const source = program.getOptionValueSource(key);
      if (source === 'default' || source === undefined) {
        opts[key] = config[rawKey];
      }
    });

    if (args.length === 0 && Array.isArray(config.files)) {
      args = config.files;
    }
  }

  return { ...opts, args };
};
