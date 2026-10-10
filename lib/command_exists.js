'use strict';

const fs = require('fs');
const path = require('path');

/**
 * True when `command` resolves to an executable file on PATH.
 */
module.exports = (command, env) => {
  const environment = env || process.env;
  const dirs = (environment.PATH || '').split(path.delimiter).filter(Boolean);
  const exts =
    process.platform === 'win32'
      ? (environment.PATHEXT || '.EXE;.CMD;.BAT').split(';')
      : [''];

  return dirs.some((dir) =>
    exts.some((ext) => {
      try {
        const file = path.join(dir, command + ext);
        fs.accessSync(file, fs.constants.X_OK);
        return fs.statSync(file).isFile();
      } catch {
        return false;
      }
    })
  );
};
