'use strict';

const { parseCookie } = require('cookie');
const cookieParser = require('cookie-parser');

/**
 * socket.io middleware that lets a connection through only if its cookie is a
 * validly *signed* express-session id AND that session is marked
 * `authenticated` in the store, i.e. this browser really passed Basic Auth.
 *
 * Both checks matter:
 *  - cookieParser.signedCookie() returns an unsigned value unchanged (and
 *    only returns false for a signed value with a bad signature), so a bare
 *    `connect.sid=anything` must be rejected explicitly;
 *  - a validly signed cookie alone proves nothing, the server signs one for
 *    every visitor that gets a session.
 *
 * socket.io middleware is per namespace: register it on every namespace that
 * must be protected.
 *
 * @param {string} secret the session secret the cookie was signed with
 * @param {{ get: (sid: string, cb: (err: any, session?: any) => void) => void }} store
 *   the express-session store holding the sessions
 */
module.exports = (secret, store) => (socket, next) => {
  const { cookie } = socket.request.headers;
  if (!cookie) {
    return next(new Error('No cookie in header'));
  }

  const encoded = parseCookie(cookie)['connect.sid'];
  if (!encoded) {
    return next(new Error('Session cookie not provided'));
  }

  const sid = encoded.startsWith('s:')
    ? cookieParser.signedCookie(encoded, secret)
    : false;
  if (typeof sid !== 'string' || !sid) {
    return next(new Error('Invalid cookie'));
  }

  return store.get(sid, (err, session) => {
    if (err || !session || session.authenticated !== true) {
      return next(new Error('Not authenticated'));
    }
    return next();
  });
};
