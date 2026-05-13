'use strict';

const connect = require('connect');
const fs = require('fs');
const path = require('path');
const serveStatic = require('serve-static');
const expressSession = require('express-session');
const basicAuth = require('basic-auth-connect');

const FILE_SIZE_WARNING_BYTES = 50 * 1024 * 1024; // 50 MB

function ConnectBuilder(urlPath) {
  this.app = connect();
  this.urlPath = urlPath;
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

ConnectBuilder.prototype.download = function download(filePaths) {
  // GET  <urlPath>/download?file=<index>   – streams the file as attachment
  // GET  <urlPath>/file-info               – returns JSON with sizes + warning flags
  const self = this;

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
    const url = new URL(req.url, 'http://localhost');
    const idx = parseInt(url.searchParams.get('file') || '0', 10);
    const fp  = filePaths[idx];
    if (!fp) {
      res.writeHead(404); res.end('Not found'); return;
    }
    let stat;
    try { stat = fs.statSync(fp); } catch (_) {
      res.writeHead(404); res.end('File not found'); return;
    }
    res.writeHead(200, {
      'Content-Type':        'application/octet-stream',
      'Content-Disposition': 'attachment; filename="' + path.basename(fp) + '"',
      'Content-Length':      stat.size,
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

  this.app.use(this.urlPath, (req, res) => {
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
