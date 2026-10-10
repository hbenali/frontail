'use strict';

const fs = require('fs');
const path = require('path');
const untildify = require('untildify');

/**
 * Resolve Basic Auth credentials. Precedence, highest first:
 * --user/--password flags, --password-file, FRONTAIL_USER/FRONTAIL_PASSWORD.
 * Keeping the password out of argv (file or env) hides it from `ps`.
 */
module.exports = function resolveCredentials(opts, env) {
  const environment = env || process.env;
  let { password } = opts;

  if (!password && opts.passwordFile) {
    const file = path.resolve(untildify(opts.passwordFile));
    try {
      // Strip only the trailing newline(s) an editor or `echo` leaves behind.
      password = fs.readFileSync(file, 'utf8').replace(/\r?\n+$/, '');
    } catch (e) {
      throw new Error(`Cannot read password file ${file}: ${e.message}`, {
        cause: e,
      });
    }
  }

  return {
    user: opts.user || environment.FRONTAIL_USER || false,
    password: password || environment.FRONTAIL_PASSWORD || false,
  };
};
