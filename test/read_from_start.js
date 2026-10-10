'use strict';

const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { io } = require('socket.io-client');

// Spawns the real server: the per-socket read policy lives in index.js.
describe('read-from-start', function readFromStart() {
  this.timeout(20000);

  const LINES = 30000;
  let dir;
  let proc;
  let base;
  let ns;

  const getPage = (retries) =>
    new Promise((resolve, reject) => {
      http
        .get(base, (res) => {
          let body = '';
          res.on('data', (c) => {
            body += c;
          });
          res.on('end', () => resolve(body));
        })
        .on('error', reject);
    }).catch((err) => {
      if (retries <= 0) throw err;
      return new Promise((r) => setTimeout(r, 100)).then(() => getPage(retries - 1));
    });

  before(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'frontail-rfs-'));
    const log = path.join(dir, 'big.log');
    fs.writeFileSync(
      log,
      Array.from({ length: LINES }, (_, i) => `line ${i}`).join('\n') + '\n'
    );
    const port = 20000 + Math.floor(Math.random() * 20000);
    base = `http://localhost:${port}`;
    proc = spawn(
      process.execPath,
      [path.join(__dirname, '..', 'bin', 'frontail'), '-p', port, '-n', '0', log],
      { stdio: 'ignore' }
    );
    ns = (await getPage(50)).match(/[0-9a-f]{32}/)[0];
  });

  after(() => {
    proc.kill();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const connect = () =>
    new Promise((resolve) => {
      const socket = io(`${base}/${ns}`, { transports: ['websocket'], reconnection: false });
      socket.on('connect', () => resolve(socket));
    });

  it('streams the whole file once', async () => {
    const socket = await connect();
    let lines = 0;
    socket.on('line', () => {
      lines += 1;
    });

    const ended = new Promise((resolve) => socket.on('read-end', resolve));
    socket.emit('read-from-start', { fileIndex: 0 });
    await ended;

    lines.should.equal(LINES);
    socket.close();
  });

  it('lets a new request replace an in-flight one: one read-end, the full file at the end', async () => {
    const socket = await connect();
    let lines = 0;
    let ends = 0;
    socket.on('line', () => {
      lines += 1;
    });
    socket.on('read-end', () => {
      ends += 1;
    });

    // Spam the request: earlier reads are cancelled, only the last completes.
    for (let i = 0; i < 5; i += 1) socket.emit('read-from-start', { fileIndex: 0 });
    await new Promise((r) => setTimeout(r, 1500));

    ends.should.equal(1);
    lines.should.be.aboveOrEqual(LINES);
    // five uncancelled reads would have delivered 5 x LINES
    lines.should.be.below(LINES * 3);
    socket.close();
  });
});
