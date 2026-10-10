'use strict';

const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const request = require('supertest');
const createMetrics = require('../lib/metrics');
const connectBuilder = require('../lib/connect_builder');

describe('metrics', () => {
  it('renders Prometheus text format', () => {
    const metrics = createMetrics('1.2.3');
    metrics.countLine('/var/log/a.log');
    metrics.countLine('/var/log/a.log');
    metrics.countLine('web');
    metrics.countError();
    metrics.gauge('frontail_connected_clients', 'Clients.', () => 4);

    const text = metrics.render();

    text.should.containEql('# TYPE frontail_build_info gauge');
    text.should.containEql('frontail_build_info{version="1.2.3"} 1');
    text.should.containEql('frontail_connected_clients 4');
    text.should.containEql('frontail_lines_total{source="/var/log/a.log"} 2');
    text.should.containEql('frontail_lines_total{source="web"} 1');
    text.should.containEql('frontail_tail_errors_total 1');
    text.should.match(/frontail_uptime_seconds \d+\n/);
    text.endsWith('\n').should.be.true;
  });

  it('escapes label values', () => {
    const metrics = createMetrics('1');
    metrics.countLine('a"b\\c\nd');

    metrics
      .render()
      .should.containEql('frontail_lines_total{source="a\\"b\\\\c\\nd"} 1');
  });

  describe('endpoint', () => {
    const registry = { render: () => 'frontail_up 1\n' };

    it('serves metrics', (done) => {
      const app = connectBuilder('/').metrics(registry).build();

      request(app)
        .get('/metrics')
        .expect('Content-Type', /text\/plain; version=0\.0\.4/)
        .expect(200, 'frontail_up 1\n', done);
    });

    it('serves metrics under the url path', (done) => {
      const app = connectBuilder('/logs').metrics(registry).build();

      request(app).get('/logs/metrics').expect(200, 'frontail_up 1\n', done);
    });

    it('sits behind Basic Auth when it is enabled', (done) => {
      const app = connectBuilder('/')
        .authorize('user', 'pass')
        .metrics(registry)
        .build();

      request(app)
        .get('/metrics')
        .expect(401, () => {
          request(app)
            .get('/metrics')
            .set('Authorization', 'Basic dXNlcjpwYXNz')
            .expect(200, 'frontail_up 1\n', done);
        });
    });
  });

  describe('server', function server() {
    this.timeout(10000);

    let dir;
    let log;
    const procs = [];

    const get = (port, urlPath) =>
      new Promise((resolve, reject) => {
        http
          .get(`http://localhost:${port}${urlPath}`, (res) => {
            let body = '';
            res.on('data', (c) => {
              body += c;
            });
            res.on('end', () => resolve({ status: res.statusCode, body }));
          })
          .on('error', reject);
      });

    const start = async (extraArgs) => {
      const port = 20000 + Math.floor(Math.random() * 20000);
      procs.push(
        spawn(
          process.execPath,
          [path.join(__dirname, '..', 'bin', 'frontail'), '-p', port, ...extraArgs, log],
          { stdio: 'ignore' }
        )
      );
      for (let i = 0; i < 50; i += 1) {
        try {
          await get(port, '/healthz');
          return port;
        } catch {
          await new Promise((r) => setTimeout(r, 100));
        }
      }
      throw new Error('server did not start');
    };

    before(() => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'frontail-metrics-'));
      log = path.join(dir, 'a.log');
      fs.writeFileSync(log, '');
    });

    after(() => {
      procs.forEach((p) => p.kill());
      fs.rmSync(dir, { recursive: true, force: true });
    });

    it('is off by default', async () => {
      const port = await start([]);

      (await get(port, '/metrics')).status.should.equal(404);
    });

    it('counts lines and sources with --metrics', async () => {
      const port = await start(['--metrics']);
      await new Promise((r) => setTimeout(r, 300));
      fs.appendFileSync(log, 'one\ntwo\n');
      await new Promise((r) => setTimeout(r, 700));

      const { status, body } = await get(port, '/metrics');

      status.should.equal(200);
      body.should.containEql('frontail_sources 1');
      body.should.containEql('frontail_connected_clients 0');
      body.should.containEql(`frontail_lines_total{source="${log}"} 2`);
    });
  });
});
