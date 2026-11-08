'use strict';

const connect = require('connect');
const fs = require('fs');
const crypto = require('crypto');
const serveStatic = require('serve-static');
const expressSession = require('express-session');
const basicAuth = require('basic-auth-connect');

const { fileInfoHandler, downloadHandler } = require('./downloads');
const { renderLoginPage, detectLang } = require('./login_page');
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

// ── Sign-in page plumbing ────────────────────────────────────────

const MAX_FORM_BYTES = 8 * 1024;
const LOGIN_WINDOW_MS = 60 * 1000;
const LOGIN_MAX_FAILURES = 10;

function readFormBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    let settled = false;
    const fail = (err) => {
      if (settled) {
        return;
      }
      settled = true;
      reject(err);
    };
    req.on('data', (chunk) => {
      if (settled) {
        return;
      }
      size += chunk.length;
      if (size > limit) {
        fail(new Error('form body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', fail);
  });
}

function parseFormEncoded(body) {
  const out = Object.create(null);
  for (const pair of String(body).split('&')) {
    if (!pair) {
      continue;
    }
    const eq = pair.indexOf('=');
    const rawKey = eq < 0 ? pair : pair.slice(0, eq);
    const rawValue = eq < 0 ? '' : pair.slice(eq + 1);
    try {
      out[decodeURIComponent(rawKey.replace(/\+/g, ' '))] = decodeURIComponent(
        rawValue.replace(/\+/g, ' ')
      );
    } catch {
      return null;
    }
  }
  return out;
}

// Only same-origin, root-relative targets are followed after sign-in, so a
// crafted `next` cannot bounce the browser to another host.
function safeNextPath(value, prefix) {
  const target = String(value || '');
  if (!target.startsWith('/') || target.startsWith('//') || target.includes('\\')) {
    return null;
  }
  if (prefix && target !== prefix && !target.startsWith(`${prefix}/`)) {
    return null;
  }
  return target;
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
 * Sign-in page instead of the browser's Basic Auth dialog.
 *
 * Mounts `<urlPath>/login` (GET renders the form, POST validates it),
 * `<urlPath>/logout` and a gate that redirects anonymous visitors to the
 * form. A successful POST marks `req.session.authenticated`, which is what
 * the log socket also checks (see lib/session_auth.js).
 *
 * @param {string} user
 * @param {string} pass
 */
ConnectBuilder.prototype.login = function login(user, pass) {
  const prefix = this.urlPath;
  const loginPath = `${prefix}/login`;
  const logoutPath = `${prefix}/logout`;
  const failures = new Map();

  const throttled = (ip) => {
    const entry = failures.get(ip);
    if (!entry) {
      return false;
    }
    if (Date.now() - entry.since > LOGIN_WINDOW_MS) {
      failures.delete(ip);
      return false;
    }
    return entry.count >= LOGIN_MAX_FAILURES;
  };

  const noteFailure = (ip) => {
    const entry = failures.get(ip);
    if (!entry || Date.now() - entry.since > LOGIN_WINDOW_MS) {
      failures.set(ip, { count: 1, since: Date.now() });
    } else {
      entry.count += 1;
    }
    // Keep the map from growing without bound on a long-lived process.
    if (failures.size > 1000) {
      failures.clear();
    }
  };

  const clientIp = (req) => {
    const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    return forwarded || req.socket.remoteAddress || 'unknown';
  };

  const sendPage = (req, res, status, error, next) => {
    const query = String(req.url || '').split('?')[1] || '';
    let lang = null;
    try {
      lang = new URLSearchParams(query).get('lang');
    } catch {
      // A malformed query string simply means "use the default language".
    }
    const html = renderLoginPage({
      action: loginPath,
      next: next || '',
      error: error || null,
      lang: detectLang(lang, req.headers['accept-language']),
    });
    res.writeHead(status, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    res.end(html);
  };

  const redirect = (res, location) => {
    res.writeHead(303, { Location: location, 'Cache-Control': 'no-store' });
    res.end();
  };

  this.app.use(loginPath, (req, res) => {
    if (req.method === 'GET' || req.method === 'HEAD') {
      if (req.session && req.session.authenticated) {
        return redirect(res, `${prefix}/`);
      }
      return sendPage(req, res, 200, null, '');
    }
    if (req.method !== 'POST') {
      res.writeHead(405, { Allow: 'GET, POST', 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Method Not Allowed');
      return undefined;
    }

    const ip = clientIp(req);
    return readFormBody(req, MAX_FORM_BYTES)
      .then((body) => {
        const form = parseFormEncoded(body);
        if (!form) {
          sendPage(req, res, 400, 'required', '');
          return;
        }
        if (throttled(ip)) {
          sendPage(req, res, 429, 'throttled', form.next);
          return;
        }
        const username = String(form.username || '');
        const password = String(form.password || '');
        if (!username || !password) {
          sendPage(req, res, 400, 'required', form.next);
          return;
        }
        const userOk = safeEqual(user, username);
        const passOk = safeEqual(pass, password);
        if (!(userOk && passOk)) {
          noteFailure(ip);
          sendPage(req, res, 401, 'invalid', form.next);
          return;
        }
        failures.delete(ip);
        const target = safeNextPath(form.next, prefix) || `${prefix}/`;
        const finish = () => redirect(res, target);
        // Fresh session id on login, so a pre-auth cookie cannot be reused.
        if (req.session && typeof req.session.regenerate === 'function') {
          req.session.regenerate((err) => {
            if (!err) {
              req.session.authenticated = true;
            }
            finish();
          });
          return;
        }
        if (req.session) {
          req.session.authenticated = true;
        }
        finish();
      })
      .catch(() => {
        sendPage(req, res, 400, 'required', '');
      });
  });

  this.app.use(logoutPath, (req, res) => {
    const finish = () => redirect(res, loginPath);
    if (req.session && typeof req.session.destroy === 'function') {
      req.session.destroy(finish);
      return;
    }
    finish();
  });

  // Everything mounted after this point (static files, the index page, the
  // log socket's HTTP side, downloads) requires the session flag.
  this.app.use(prefix, (req, res, next) => {
    if (req.session && req.session.authenticated) {
      return next();
    }
    if (req.method === 'GET' || req.method === 'HEAD') {
      const wanted = safeNextPath(`${prefix}${req.url || ''}`, prefix);
      const location = wanted ? `${loginPath}?next=${encodeURIComponent(wanted)}` : loginPath;
      res.writeHead(302, { Location: location, 'Cache-Control': 'no-store' });
      res.end();
      return undefined;
    }
    res.writeHead(401, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Unauthorized');
    return undefined;
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
  // Revalidate on every load: after an upgrade the browser must not keep
  // running yesterday's app.js while the server already serves new code.
  this.app.use(this.urlPath, serveStatic(staticPath, {
    etag: true,
    lastModified: true,
    setHeaders: function setNoCacheHeaders(res) {
      res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    },
  }));
  return this;
};

module.exports = (urlPath) => new ConnectBuilder(urlPath);
