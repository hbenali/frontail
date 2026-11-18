'use strict';

const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const FRONTAIL = path.join(__dirname, '..', 'bin', 'frontail');

// The throttle keeps state per client address, so these cases run against
// their own servers: a shared one would carry the failures into other tests.
describe('login throttle', function loginThrottle() {
  this.timeout(30000);

  let dir;
  const servers = [];

  function startServer(extraArgs) {
    const port = 20000 + Math.floor(Math.random() * 20000);
    const proc = spawn(
      process.execPath,
      [FRONTAIL, '-p', String(port), '-U', 'user', '-P', 'pass'].concat(
        extraArgs || [],
        [path.join(dir, 'a.log')]
      ),
      { stdio: 'ignore' }
    );
    servers.push(proc);
    const base = 'http://localhost:' + port;
    return waitForServer(base + '/healthz', 100).then(() => base);
  }

  function waitForServer(url, retries) {
    return new Promise((resolve, reject) => {
      const req = http.get(url, (res) => {
        res.resume();
        resolve();
      });
      req.on('error', (err) => {
        if (retries <= 0) return reject(err);
        setTimeout(() => waitForServer(url, retries - 1).then(resolve, reject), 100);
      });
    });
  }

  function postLogin(base, headers) {
    const body = 'username=user&password=wrong';
    return new Promise((resolve, reject) => {
      const req = http.request(
        base + '/login',
        {
          method: 'POST',
          headers: Object.assign(
            {
              'content-type': 'application/x-www-form-urlencoded',
              'content-length': Buffer.byteLength(body),
            },
            headers || {}
          ),
        },
        (res) => {
          res.resume();
          res.on('end', () => resolve(res));
        }
      );
      req.on('error', reject);
      req.end(body);
    });
  }

  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'frontail-throttle-'));
    fs.writeFileSync(path.join(dir, 'a.log'), 'hello\n');
  });

  after(() => {
    servers.forEach((proc) => proc.kill());
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('keys the throttle on the socket address, not on X-Forwarded-For', async () => {
    const base = await startServer([]);
    for (let attempt = 1; attempt <= 10; attempt++) {
      const res = await postLogin(base, {
        'x-forwarded-for': '203.0.113.' + attempt,
      });
      res.statusCode.should.equal(401);
    }
    // A fresh, made-up address in the header must not buy a fresh allowance.
    const blocked = await postLogin(base, { 'x-forwarded-for': '203.0.113.99' });
    blocked.statusCode.should.equal(429);
  });

  it('throttles X-Forwarded-For per address only with --trusted-proxy', async () => {
    const base = await startServer(['--trusted-proxy']);
    const headers = { 'x-forwarded-for': '198.51.100.7' };
    for (let attempt = 1; attempt <= 10; attempt++) {
      const res = await postLogin(base, headers);
      res.statusCode.should.equal(401);
    }
    const blocked = await postLogin(base, headers);
    blocked.statusCode.should.equal(429);
    // Behind the proxy another client is a different key and still gets in.
    const other = await postLogin(base, { 'x-forwarded-for': '198.51.100.8' });
    other.statusCode.should.equal(401);
  });
});
