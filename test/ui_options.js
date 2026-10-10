'use strict';

const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { io } = require('socket.io-client');

// Spawns the real server: which options:* events the browser receives is
// decided in index.js. Regression guard for the commander upgrade, which
// inverted --ui-no-colors / --ui-no-indent (colors were off by default).
describe('UI option events', function uiOptions() {
  this.timeout(10000);

  let dir;
  let log;
  const procs = [];

  function start(extraArgs) {
    const port = 20000 + Math.floor(Math.random() * 20000);
    const proc = spawn(
      process.execPath,
      [path.join(__dirname, '..', 'bin', 'frontail'), '-p', port, ...extraArgs, log],
      { stdio: 'ignore' }
    );
    procs.push(proc);
    const base = `http://localhost:${port}`;

    const page = (retries) =>
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
        return new Promise((r) => setTimeout(r, 100)).then(() => page(retries - 1));
      });

    return page(50).then((body) => ({ base, ns: body.match(/[0-9a-f]{32}/)[0] }));
  }

  // Collects every options:* event the server sends on connect.
  function optionEvents({ base, ns }) {
    return new Promise((resolve) => {
      const socket = io(`${base}/${ns}`, { transports: ['polling'], reconnection: false });
      const seen = [];
      socket.onAny((event) => {
        if (event.startsWith('options:')) seen.push(event);
        // options:sources is the last one emitted before the buffer replay.
        if (event === 'options:source-info') {
          socket.close();
          resolve(seen);
        }
      });
    });
  }

  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'frontail-ui-'));
    log = path.join(dir, 'a.log');
    fs.writeFileSync(log, 'hello\n');
  });

  after(() => {
    procs.forEach((p) => p.kill());
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('leaves colors and indentation on by default', async () => {
    const events = await optionEvents(await start([]));

    events.should.not.containEql('options:no-colors');
    events.should.not.containEql('options:no-indent');
  });

  it('turns colors and indentation off when asked', async () => {
    const events = await optionEvents(
      await start(['--ui-no-colors', '--ui-no-indent'])
    );

    events.should.containEql('options:no-colors');
    events.should.containEql('options:no-indent');
  });
});
