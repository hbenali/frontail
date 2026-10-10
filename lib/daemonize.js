'use strict';

const daemon = require('daemon-fix41');
const fs = require('fs');

const defaultOptions = {
  doAuthorization: false,
  doSecure: false,
};

module.exports = (script, params, opts) => {
  const options = opts || defaultOptions;

  const logFile = fs.openSync(params.logPath, 'a');

  const daemonOptions = { stdout: logFile, stderr: logFile };

  let args = [
    '-h',
    params.host,
    '-p',
    params.port,
    '-n',
    params.number,
    '-l',
    params.lines,
    '-t',
    params.theme,
  ];

  if (options.doAuthorization) {
    // Hand credentials over via the environment, not argv, so they stay
    // out of `ps` output.
    const creds = options.credentials || params;
    daemonOptions.env = {
      ...process.env,
      FRONTAIL_USER: creds.user,
      FRONTAIL_PASSWORD: creds.password,
    };
  }

  if (options.doSecure) {
    args.push('-k', params.key, '-c', params.certificate);
  }

  if (params.uiHideTopbar) {
    args.push('--ui-hide-topbar');
  }

  if (params.urlPath) {
    args.push('--url-path', params.urlPath);
  }

  if (params.uiNoIndent) {
    args.push('--ui-no-indent');
  }

  if (params.uiNoColors) {
    args.push('--ui-no-colors');
  }

  if (params.uiColorsPreset) {
    args.push('--ui-colors-preset', params.uiColorsPreset);
  }

  (params.allowedOrigin || []).forEach((origin) => {
    args.push('--allowed-origin', origin);
  });

  (params.container || []).forEach((container) => {
    args.push('-C', container);
  });

  if (params.container && params.container.length > 0 && params.containerEngine) {
    args.push('--container-engine', params.containerEngine);
  }

  if (params.uiHighlight) {
    args.push('--ui-highlight');
  }

  if (params.uiHighlightPreset) {
    args.push('--ui-highlight-preset', params.uiHighlightPreset);
  }

  args = args.concat(params.args);

  const proc = daemon.daemon(script, args, daemonOptions);

  fs.writeFileSync(params.pidPath, String(proc.pid));
};
