'use strict';

const connect = require('connect');
const fs = require('fs');
const crypto = require('crypto');
const serveStatic = require('serve-static');
const expressSession = require('express-session');
const basicAuth = require('basic-auth-connect');

const { fileInfoHandler, downloadHandler } = require('./downloads');
// No inline or third-party scripts (script-src 'self'). Inline style
// attributes stay allowed because the UI generates them (highlight/colour
// rules); Google Fonts is the only external origin. WebSocket traffic is
// same-origin ('self' covers ws/wss), and frame-ancestors supersedes
// X-Frame-Options in modern browsers.
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
].join('; ');

function escapeHtml(text) {
  return String(text).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

// Constant-time equality for credentials. Both values are zero-padded to the
// same length so timingSafeEqual accepts them, then the real lengths are
// compared too; no hashing is involved (this is a comparison, not storage).
function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  const size = Math.max(left.length, right.length, 1);
  const paddedLeft = Buffer.alloc(size);
  const paddedRight = Buffer.alloc(size);
  left.copy(paddedLeft);
  right.copy(paddedRight);
  return crypto.timingSafeEqual(paddedLeft, paddedRight) && left.length === right.length;
}

function ConnectBuilder(urlPath) {
  this.app = connect();
  this.urlPath = (urlPath || '/').replace(/\/$/, '');
}

ConnectBuilder.prototype.health = function health() {
  // Fixed path, mounted ahead of auth/urlPath-scoped middleware, so a
  // container-internal healthcheck never needs credentials or to know
  // about --url-path/--path.
  this.app.use('/healthz', (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') { return next(); }
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('OK');
    return undefined;
  });

  return this;
};

ConnectBuilder.prototype.securityHeaders = function securityHeaders() {
  this.app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', CONTENT_SECURITY_POLICY);
    next();
  });

  return this;
};

// GET <urlPath>/metrics in Prometheus text format. Mount after authorize()
// so it sits behind Basic Auth like the rest of the app.
ConnectBuilder.prototype.metrics = function metrics(registry) {
  this.app.use(`${this.urlPath}/metrics`, (req, res, next) => {
    if (req.method !== 'GET' || (req.url !== '/' && req.url !== '')) {
      return next();
    }
    res.writeHead(200, {
      'Content-Type': 'text/plain; version=0.0.4; charset=utf-8',
    });
    res.end(registry.render());
    return undefined;
  });

  return this;
};

ConnectBuilder.prototype.authorize = function authorize(user, pass) {
  this.app.use(
    this.urlPath,
    basicAuth(
      (incomingUser, incomingPass) => {
        // Evaluate both so a wrong user takes as long as a wrong password.
        const userOk = safeEqual(user, incomingUser);
        const passOk = safeEqual(pass, incomingPass);
        return userOk && passOk;
      }
    )
  );

  // Reached only after Basic Auth succeeded: record it in the session so the
  // log socket (which cannot send an Authorization header) can verify it.
  this.app.use(this.urlPath, (req, res, next) => {
    if (req.session) {
      req.session.authenticated = true;
    }
    next();
  });

  return this;
};

/**
 * Mounts <urlPath>/file-info and <urlPath>/download (see lib/downloads.js).
 * @param {string[]} filePaths
 * @param {{ containers?: string[], engine?: string, commands?: () => { name: string, command: string, args: string[] }[] }} [sourceOpts]
 */
ConnectBuilder.prototype.download = function download(filePaths, sourceOpts) {
  this.app.use(`${this.urlPath}/file-info`, fileInfoHandler(filePaths));
  this.app.use(
    `${this.urlPath}/download`,
    downloadHandler({ filePaths, ...sourceOpts })
  );

  return this;
};

ConnectBuilder.prototype.build = function build() {
  return this.app;
};

ConnectBuilder.prototype.index = function index(
  indexPath,
  files,
  filesNamespace,
  themeOpt,
  version
) {
  const theme = themeOpt || 'default';

  // Only serve the SPA shell on GET / — not on every sub-path
  this.app.use(this.urlPath, (req, res, next) => {
    const p = req.url.split('?')[0];
    if (req.method !== 'GET' || (p !== '/' && p !== '')) { return next(); }
    fs.readFile(indexPath, (err, data) => {
      if (err) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Internal Server Error');
        return;
      }
      res.writeHead(200, {
        'Content-Type': 'text/html',
      });
      res.end(
        data
          .toString('utf-8')
          // Function replacers: a literal string would interpret "$&" etc.
          // in file names. The title is HTML-escaped: it is built from
          // user-supplied file and container names.
          .replace(/__TITLE__/g, () => escapeHtml(files))
          .replace(/__THEME__/g, () => escapeHtml(theme))
          .replace(/__NAMESPACE__/g, () => escapeHtml(filesNamespace))
          .replace(/__PATH__/g, () => escapeHtml(this.urlPath))
          .replace(/__VERSION__/g, () => escapeHtml(version || '')),
        'utf-8'
      );
    });
    return undefined;
  });

  return this;
};

ConnectBuilder.prototype.session = function sessionf(secret, secureCookie, store) {
  this.app.use(
    this.urlPath,
    expressSession({
      secret,
      store,
      resave: false,
      // Sessions are only created once authorize() marks them, so visitors
      // who fail Basic Auth never receive a session cookie.
      saveUninitialized: false,
      cookie: {
        secure: !!secureCookie,
        httpOnly: true,
        sameSite: 'lax',
        maxAge: 24 * 60 * 60 * 1000,
      },
    })
  );
  return this;
};

ConnectBuilder.prototype.static = function staticf(staticPath) {
  this.app.use(this.urlPath, serveStatic(staticPath));
  return this;
};

module.exports = (urlPath) => new ConnectBuilder(urlPath);
