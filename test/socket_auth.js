'use strict';

const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { io } = require('socket.io-client');

// Spawns the real server: the auth wiring lives in index.js, which cannot be
// unit-tested in isolation.
describe('socket.io authorization', function socketAuth() {
  this.timeout(10000);

  const port = 20000 + Math.floor(Math.random() * 20000);
  const base = `http://localhost:${port}`;
  const basic = `Basic ${Buffer.from('user:pass').toString('base64')}`;
  let dir;
  let proc;
  let namespace;
  let sessionCookie;

  function get() {
    return new Promise((resolve, reject) => {
      http
        .get(base, { headers: { authorization: basic } }, (res) => {
          let body = '';
          res.on('data', (c) => {
            body += c;
          });
          res.on('end', () => resolve({ res, body }));
        })
        .on('error', reject);
    });
  }

  function waitForServer(retries) {
    return get().catch((err) => {
      if (retries <= 0) throw err;
      return new Promise((r) => setTimeout(r, 100)).then(() =>
        waitForServer(retries - 1)
      );
    });
  }

  function connect(cookie, origin) {
    return new Promise((resolve) => {
      const socket = io(`${base}/${namespace}`, {
        transports: ['polling'],
        reconnection: false,
        extraHeaders: {
          ...(cookie ? { cookie } : {}),
          ...(origin ? { origin } : {}),
        },
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
  }

  before(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'frontail-sock-'));
    const log = path.join(dir, 'a.log');
    fs.writeFileSync(log, 'hello\n');
    proc = spawn(
      process.execPath,
      [path.join(__dirname, '..', 'bin', 'frontail'), '-p', port, '-U', 'user', '-P', 'pass', log],
      { stdio: 'ignore' }
    );
    const { res, body } = await waitForServer(50);
    namespace = body.match(/[0-9a-f]{32}/)[0];
    sessionCookie = res.headers['set-cookie'][0].split(';')[0];
  });

  after(() => {
    proc.kill();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('accepts a connection with a valid session cookie', async () => {
    (await connect(sessionCookie)).should.equal('connected');
  });

  it('accepts a same-origin browser connection', async () => {
    (await connect(sessionCookie, base)).should.equal('connected');
  });

  it('rejects a cross-site browser connection even with a valid cookie', async () => {
    (await connect(sessionCookie, 'https://evil.example')).should.not.equal(
      'connected'
    );
  });

  it('rejects a connection without a cookie', async () => {
    (await connect()).should.equal('No cookie in header');
  });

  it('rejects a connection with a forged cookie', async () => {
    (await connect('connect.sid=s%3Aforged.sig')).should.equal(
      'Invalid cookie'
    );
  });
});
