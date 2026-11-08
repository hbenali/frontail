'use strict';

const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { io: connectSocket } = require('socket.io-client');
const parseOptions = require('../lib/options_parser');
const { resolveSettings, start } = require('../lib/frontail');

// In-process: the server is a plain object now, no child process needed.
describe('frontail (start / resolveSettings)', function frontail() {
  this.timeout(10000);

  let dir;
  let log;
  const running = [];

  const options = (...extra) =>
    parseOptions(['node', 'frontail', '-p', '0', '-h', '127.0.0.1', '-n', '2', ...extra, log]);

  // Resolves once the server is listening (port 0 = a free port).
  const launch = async (...extra) => {
    const app = start(options(...extra));
    running.push(app);
    if (!app.server.listening) {
      await new Promise((resolve) => app.server.once('listening', resolve));
    }
    const { port } = app.server.address();
    return { app, port, base: `http://127.0.0.1:${port}` };
  };

  const get = (base, urlPath, headers) =>
    new Promise((resolve, reject) => {
      http
        .get(`${base}${urlPath}`, { headers }, (res) => {
          let body = '';
          res.on('data', (c) => {
            body += c;
          });
          res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
        })
        .on('error', reject);
    });

  const post = (base, urlPath, form, headers) =>
    new Promise((resolve, reject) => {
      const payload = new URLSearchParams(form).toString();
      const req = http.request(
        `${base}${urlPath}`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/x-www-form-urlencoded',
            'content-length': Buffer.byteLength(payload),
            ...headers,
          },
        },
        (res) => {
          let body = '';
          res.on('data', (c) => {
            body += c;
          });
          res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
        }
      );
      req.on('error', reject);
      req.end(payload);
    });

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'frontail-inproc-'));
    log = path.join(dir, 'a.log');
    fs.writeFileSync(log, 'one\ntwo\nthree\n');
  });

  afterEach(async () => {
    await Promise.all(running.splice(0).map((app) => new Promise((r) => app.close(r))));
    fs.rmSync(dir, { recursive: true, force: true });
  });

  describe('resolveSettings', () => {
    it('derives the title, namespace and auth/TLS flags', () => {
      const settings = resolveSettings(
        parseOptions(['node', 'f', '-U', 'u', '-P', 'p', '--url-path', '/logs/', '/a.log', '/b.log'])
      );

      settings.files.should.equal('/a.log /b.log');
      settings.filesNamespace.should.match(/^[0-9a-f]{32}$/);
      settings.doAuthorization.should.be.true;
      settings.doSecure.should.be.false;
      settings.urlPath.should.equal('/logs');
      settings.credentials.user.should.equal('u');
    });

    it('includes command sources in the title and namespace', () => {
      const withJournal = resolveSettings(parseOptions(['node', 'f', '--journal-unit', 'sshd']));
      const without = resolveSettings(parseOptions(['node', 'f', '/a.log']));

      withJournal.files.should.equal('journal:sshd');
      withJournal.filesNamespace.should.not.equal(without.filesNamespace);
    });

    it('rejects invalid ssh targets and units', () => {
      (() => resolveSettings(parseOptions(['node', 'f', '--ssh', '-oProxyCommand=x:/a']))).should.throw(/Invalid --ssh/);
      (() => resolveSettings(parseOptions(['node', 'f', '--journal-unit', '-f']))).should.throw(/Invalid --journal-unit/);
    });
  });

  describe('start', () => {
    it('serves the page, health check and assets', async () => {
      const { base } = await launch();

      const page = await get(base, '/');
      page.status.should.equal(200);
      page.body.should.containEql('init.js');
      page.headers['content-security-policy'].should.containEql("script-src 'self'");
      (await get(base, '/healthz')).status.should.equal(200);
      (await get(base, '/formats.js')).status.should.equal(200);
      (await get(base, '/metrics')).status.should.equal(404); // off by default
    });

    it('streams the buffered and new lines to a browser socket', async () => {
      const { base } = await launch();
      const ns = (await get(base, '/')).body.match(/[0-9a-f]{32}/)[0];

      const socket = connectSocket(`${base}/${ns}`, { transports: ['websocket'], reconnection: false });
      const lines = [];
      socket.on('line', (l) => lines.push(l.t));
      await new Promise((resolve) => socket.on('options:source-info', resolve));
      await new Promise((r) => setTimeout(r, 200));
      fs.appendFileSync(log, 'four\n');
      await new Promise((r) => setTimeout(r, 700));
      socket.close();

      lines.should.eql(['two', 'three', 'four']); // -n 2, then the new line
    });

    it('reports its sources and counts lines in the metrics', async () => {
      const { base } = await launch('--metrics');
      await new Promise((r) => setTimeout(r, 300));
      fs.appendFileSync(log, 'x\ny\n');
      await new Promise((r) => setTimeout(r, 700));

      const { body } = await get(base, '/metrics');

      body.should.containEql('frontail_sources 1');
      // 2 lines replayed at start (-n 2) + the 2 appended
      body.should.containEql(`frontail_lines_total{source="${log}"} 4`);
    });

    it('protects the page and the socket behind the sign-in page', async () => {
      const { base } = await launch('-U', 'user', '-P', 'pass');

      // Anonymous visitors are redirected to the form, not challenged with a
      // browser dialog.
      const anonymous = await get(base, '/');
      anonymous.status.should.equal(302);
      anonymous.headers.location.should.match(/\/login/);

      const form = await get(base, '/login');
      form.status.should.equal(200);
      form.body.should.containEql('name="username"');
      form.body.should.containEql('name="password"');

      const wrong = await post(base, '/login', { username: 'user', password: 'nope' });
      wrong.status.should.equal(401);
      (wrong.headers['set-cookie'] === undefined).should.be.true;

      const ok = await post(base, '/login', { username: 'user', password: 'pass' });
      ok.status.should.equal(303);
      const cookie = ok.headers['set-cookie'][0].split(';')[0];

      const authed = await get(base, '/', { cookie });
      authed.status.should.equal(200);
      const ns = authed.body.match(/[0-9a-f]{32}/)[0];

      const connect = (cookieHeader) =>
        new Promise((resolve) => {
          const socket = connectSocket(`${base}/${ns}`, {
            transports: ['polling'],
            reconnection: false,
            extraHeaders: cookieHeader ? { cookie: cookieHeader } : {},
          });
          socket.on('connect', () => {
            socket.close();
            resolve('connected');
          });
          socket.on('connect_error', (e) => {
            socket.close();
            resolve(e.message);
          });
        });

      (await connect(cookie)).should.equal('connected');
      (await connect()).should.equal('No cookie in header');
      (await connect('connect.sid=anything')).should.equal('Invalid cookie');

      // Logging out drops the session and the page is protected again.
      await get(base, '/logout', { cookie });
      (await get(base, '/', { cookie })).status.should.equal(302);
    });

    it('close() stops the server and the tailer', async () => {
      const { app } = await launch();

      await new Promise((resolve) => app.close(resolve));

      app.server.listening.should.be.false;
    });

    it('fails clearly on a missing preset file', () => {
      (() => start(options('--ui-highlight', '--ui-highlight-preset', path.join(dir, 'nope.json')))).should.throw(
        /Preset file .*nope\.json doesn't exists/
      );
    });
  });
});
