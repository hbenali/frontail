'use strict';

const connect = require('connect');
const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');
const serveStatic = require('serve-static');
const expressSession = require('express-session');
const basicAuth = require('basic-auth-connect');

const FILE_SIZE_WARNING_BYTES = 50 * 1024 * 1024; // 50 MB

function ConnectBuilder(urlPath) {
  this.app = connect();
  this.urlPath = (urlPath || '/').replace(/\/$/, '');
}

ConnectBuilder.prototype.authorize = function authorize(user, pass) {
  this.app.use(
    this.urlPath,
    basicAuth(
      (incomingUser, incomingPass) =>
        user === incomingUser && pass === incomingPass
    )
  );

  return this;
};

ConnectBuilder.prototype.download = function download(filePaths, containerOpts) {
  // GET  <urlPath>/download?file=<index>        – streams the file as attachment
  // GET  <urlPath>/download?container=<index>    – streams container logs as attachment
  // GET  <urlPath>/file-info                      – returns JSON with sizes + warning flags
  const self = this;
  const containerList = (containerOpts && containerOpts.containers) || [];
  const containerEngine = (containerOpts && containerOpts.engine) || 'docker';

  this.app.use(this.urlPath + '/file-info', (req, res) => {
    const info = filePaths.map((fp, idx) => {
      let size = 0;
      let exists = false;
      try {
        size = fs.statSync(fp).size;
        exists = true;
      } catch (_) { /* ignore */ }
      return {
        index: idx,
        name: path.basename(fp),
        path: fp,
        size,
        exists,
        tooLarge: size > FILE_SIZE_WARNING_BYTES,
      };
    });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(info));
  });

  this.app.use(this.urlPath + '/download', (req, res) => {
    const rawUrl = req.originalUrl || req.url;
    const qIndex = rawUrl.indexOf('?');
    const qs     = qIndex !== -1 ? rawUrl.slice(qIndex + 1) : '';
    const params = new URLSearchParams(qs);

    // Container download
    if (params.has('container')) {
      const idx       = parseInt(params.get('container') || '0', 10);
      const container = containerList[idx];
      if (!container) { res.writeHead(404); res.end('Container not found'); return; }
      const cp = childProcess.spawn(containerEngine, ['logs', container]);
      const filename = container + '.log';
      res.writeHead(200, {
        'Content-Type':        'application/octet-stream',
        'Content-Disposition': 'attachment; filename="' + filename + '"; filename*=UTF-8\'\''
                               + encodeURIComponent(filename),
        'Cache-Control':       'no-store',
      });
      cp.stdout.pipe(res);
      cp.stderr.on('data', () => {}); // swallow stderr
      cp.on('error', () => { if (!res.headersSent) { res.writeHead(500); res.end('Error'); } });
      return;
    }

    // File download
    const idx = parseInt(params.get('file') || '0', 10);
    const fp  = filePaths[idx];
    if (!fp) { res.writeHead(404); res.end('Not found'); return; }
    let stat;
    try { stat = fs.statSync(fp); } catch (_) {
      res.writeHead(404); res.end('File not found'); return;
    }
    const filename = path.basename(fp);
    res.writeHead(200, {
      'Content-Type':        'application/octet-stream',
      'Content-Disposition': 'attachment; filename="' + filename + '"; filename*=UTF-8\'\''
                             + encodeURIComponent(filename),
      'Content-Length':      stat.size,
      'Cache-Control':       'no-store',
    });
    fs.createReadStream(fp).pipe(res);
  });

  return self;
};

ConnectBuilder.prototype.build = function build() {
  return this.app;
};

ConnectBuilder.prototype.index = function index(
  path,
  files,
  filesNamespace,
  themeOpt
) {
  const theme = themeOpt || 'default';

  // Only serve the SPA shell on GET / — not on every sub-path
  this.app.use(this.urlPath, (req, res, next) => {
    const p = req.url.split('?')[0];
    if (req.method !== 'GET' || (p !== '/' && p !== '')) { return next(); }
    fs.readFile(path, (err, data) => {
      res.writeHead(200, {
        'Content-Type': 'text/html',
      });
      res.end(
        data
          .toString('utf-8')
          .replace(/__TITLE__/g, files)
          .replace(/__THEME__/g, theme)
          .replace(/__NAMESPACE__/g, filesNamespace)
          .replace(/__PATH__/g, this.urlPath),
        'utf-8'
      );
    });
  });

  return this;
};

ConnectBuilder.prototype.session = function sessionf(secret) {
  this.app.use(
    this.urlPath,
    expressSession({
      secret,
      resave: false,
      saveUninitialized: true,
    })
  );
  return this;
};

ConnectBuilder.prototype.static = function staticf(path) {
  this.app.use(this.urlPath, serveStatic(path));
  return this;
};

module.exports = (urlPath) => new ConnectBuilder(urlPath);
