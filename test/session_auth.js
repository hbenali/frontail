'use strict';

const crypto = require('crypto');
const createSessionAuth = require('../lib/session_auth');

// express-session cookie format: s:<value>.<base64 hmac-sha256, no padding>
const signed = (value, secret) =>
  encodeURIComponent(
    `s:${value}.${crypto
      .createHmac('sha256', secret)
      .update(value)
      .digest('base64')
      .replace(/=+$/, '')}`
  );

describe('session auth (socket.io middleware)', () => {
  const secret = 'top-secret';
  const sessions = {
    good: { authenticated: true },
    visitor: { cookie: {} }, // has a session, never passed Basic Auth
    falsy: { authenticated: 'true' },
  };
  const store = { get: (sid, cb) => cb(null, sessions[sid]) };
  const middleware = createSessionAuth(secret, store);

  const run = (cookie) => {
    let result = 'pending';
    middleware(
      { request: { headers: cookie === undefined ? {} : { cookie } } },
      (err) => {
        result = err;
      }
    );
    return result;
  };

  it('accepts a signed cookie for an authenticated session', () => {
    (run(`connect.sid=${signed('good', secret)}`) === undefined).should.be.true;
  });

  it('rejects a validly signed cookie whose session never passed Basic Auth', () => {
    run(`connect.sid=${signed('visitor', secret)}`).message.should.equal('Not authenticated');
  });

  it('requires authenticated to be exactly true', () => {
    run(`connect.sid=${signed('falsy', secret)}`).message.should.equal('Not authenticated');
  });

  it('rejects a signed cookie for an unknown or expired session', () => {
    run(`connect.sid=${signed('gone', secret)}`).message.should.equal('Not authenticated');
  });

  it('rejects a bare, unsigned cookie even if it names a real session', () => {
    // cookie-parser returns unsigned values unchanged, so this must be
    // rejected explicitly or anyone could connect with connect.sid=good
    run('connect.sid=good').message.should.equal('Invalid cookie');
    run('connect.sid=anything').message.should.equal('Invalid cookie');
  });

  it('rejects a cookie signed with another secret, or a tampered signature', () => {
    run(`connect.sid=${signed('good', 'wrong')}`).message.should.equal('Invalid cookie');
    run(`connect.sid=${signed('good', secret)}x`).message.should.equal('Invalid cookie');
  });

  it('rejects a missing cookie header or session cookie', () => {
    run().message.should.equal('No cookie in header');
    run('other=1').message.should.equal('Session cookie not provided');
  });

  it('rejects when the store errors', () => {
    const failing = createSessionAuth(secret, { get: (sid, cb) => cb(new Error('boom')) });
    let result;
    failing(
      { request: { headers: { cookie: `connect.sid=${signed('good', secret)}` } } },
      (err) => {
        result = err;
      }
    );
    result.message.should.equal('Not authenticated');
  });
});
