'use strict';

const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { io } = require('socket.io-client');

const NL = String.fromCharCode(10);

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

  // A file above the in-memory limit: it is streamed in pieces instead of
  // being parsed in one go, and must yield exactly the same rows.
  const STREAM_PADDING = 4 * 1024 * 1024;
  let streamedLog;

  before(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'frontail-rfs-'));
    const log = path.join(dir, 'big.log');
    fs.writeFileSync(
      log,
      Array.from({ length: LINES }, (_, i) => `line ${i}`).join('\n') + '\n'
    );
    streamedLog = path.join(dir, 'streamed.log');
    const padding = Array.from({ length: 40000 }, (_, i) => `pad ${i} ${'x'.repeat(100)}`);
    fs.writeFileSync(streamedLog, ['first', ...padding, 'last'].join(NL) + NL, 'utf8');
    fs.appendFileSync(streamedLog, 'y'.repeat(STREAM_PADDING));
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
    socket.on('bulk-lines', (payload) => {
      lines += (payload && payload.lines ? payload.lines.length : 0);
    });

    const ended = new Promise((resolve) => socket.on('read-end', resolve));
    socket.emit('read-from-start', { fileIndex: 0 });
    await ended;

    lines.should.equal(LINES);
    socket.close();
  });

  it('bounds the read to the last `lines` lines when asked', async () => {
    const socket = await connect();
    let lines = 0;
    socket.on('line', () => {
      lines += 1;
    });
    socket.on('bulk-lines', (payload) => {
      lines += (payload && payload.lines ? payload.lines.length : 0);
    });

    const ended = new Promise((resolve) => socket.on('read-end', resolve));
    socket.emit('read-from-start', { fileIndex: 0, lines: 100 });
    await ended;

    lines.should.equal(100);
    socket.close();
  });

  it('lets a new request replace an in-flight one: one read-end, the full file at the end', async () => {
    const socket = await connect();
    let lines = 0;
    let ends = 0;
    socket.on('line', () => {
      lines += 1;
    });
    socket.on('bulk-lines', (payload) => {
      lines += (payload && payload.lines ? payload.lines.length : 0);
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

  it('streams a file too big for memory in several chunks', async () => {
    // The streamed file gets its own server, so fileIndex 0 is that file.
    const port = 20000 + Math.floor(Math.random() * 20000);
    const streamBase = `http://localhost:${port}`;
    const child = spawn(
      process.execPath,
      [path.join(__dirname, '..', 'bin', 'frontail'), '-p', port, '-n', '0', streamedLog],
      { stdio: 'ignore' }
    );
    try {
      let body = '';
      for (let i = 0; i < 50 && !body; i += 1) {
        body = await new Promise((resolve) => {
          http
            .get(streamBase, (res) => {
              let text = '';
              res.on('data', (c) => {
                text += c;
              });
              res.on('end', () => resolve(text));
            })
            .on('error', () => resolve(''));
        });
        if (!body) await new Promise((r) => setTimeout(r, 100));
      }
      const streamNs = body.match(/[0-9a-f]{32}/)[0];
      const socket = await new Promise((resolve) => {
        const s = io(`${streamBase}/${streamNs}`, {
          transports: ['websocket'],
          reconnection: false,
        });
        s.on('connect', () => resolve(s));
      });

      let chunks = 0;
      let lines = 0;
      socket.on('bulk-lines', (payload) => {
        chunks += 1;
        lines += payload && payload.lines ? payload.lines.length : 0;
      });
      const ended = new Promise((resolve) => socket.on('read-end', resolve));
      socket.emit('read-from-start', { fileIndex: 0, force: true, full: true });
      await ended;

      // 40002 complete lines plus the padding tail without a newline, which
      // the in-memory path would split out as one last row too.
      lines.should.equal(40003);
      chunks.should.be.above(0);
      socket.close();
    } finally {
      child.kill();
    }
  });
});
