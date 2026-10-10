'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');
const connectBuilder = require('../lib/connect_builder');
const { sanitizedFilename } = require('../lib/downloads');

describe('downloads', () => {
  let dir;
  let file;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'frontail-dl-'));
    file = path.join(dir, 'app.log');
    fs.writeFileSync(file, 'plain\n\u001b[31mred\u001b[0m\n');
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const app = (sourceOpts) =>
    connectBuilder('/').download([file], sourceOpts).build();

  // supertest only exposes text bodies for text content types; downloads are
  // application/octet-stream, so collect the bytes ourselves.
  const download = (a, url) =>
    request(a)
      .get(url)
      .buffer(true)
      .parse((res, callback) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => callback(null, Buffer.concat(chunks).toString('utf8')));
      });

  it('names sanitized files before the extension', () => {
    sanitizedFilename('app.log').should.equal('app.sanitized.log');
    sanitizedFilename('syslog').should.equal('syslog.sanitized');
  });

  it('lists files with sizes in /file-info', (done) => {
    request(app())
      .get('/file-info')
      .expect(200)
      .end((err, res) => {
        const [info] = JSON.parse(res.text);
        info.name.should.equal('app.log');
        info.exists.should.be.true;
        info.tooLarge.should.be.false;
        done(err);
      });
  });

  it('downloads a file with its size and a safe attachment name', (done) => {
    request(app())
      .get('/download?file=0')
      .expect('Content-Disposition', /attachment; filename="app\.log"/)
      .expect('Content-Length', String(fs.statSync(file).size))
      .expect(200, done);
  });

  it('strips ANSI codes line by line with sanitize=1', (done) => {
    download(app(), '/download?file=0&sanitize=1')
      .expect('Content-Disposition', /app\.sanitized\.log/)
      .expect(200)
      .end((err, res) => {
        res.body.should.equal('plain\nred\n\n');
        done(err);
      });
  });

  it('answers 404 for unknown sources', (done) => {
    const a = app({ containers: ['c1'], commands: () => [] });

    request(a).get('/download?file=5').expect(404, () => {
      request(a).get('/download?container=3').expect(404, () => {
        request(a).get('/download?command=0').expect(404, done);
      });
    });
  });

  it('streams a journal/ssh style command as a download', (done) => {
    const commands = () => [
      {
        name: 'journal:sshd',
        command: process.execPath,
        args: ['-e', "console.log('line one'); console.log('\\u001b[32mline two\\u001b[0m')"],
      },
    ];

    download(app({ commands }), '/download?command=0')
      .expect('Content-Disposition', /attachment; filename="journal_sshd\.log"/)
      .expect(200)
      .end((err, res) => {
        res.body.should.equal('line one\n\u001b[32mline two\u001b[0m\n');
        done(err);
      });
  });

  it('sanitizes a command download too', (done) => {
    const commands = () => [
      {
        name: 'web1:/var/log/syslog',
        command: process.execPath,
        args: ['-e', "console.log('\\u001b[32mgreen\\u001b[0m')"],
      },
    ];

    download(app({ commands }), '/download?command=0&sanitize=1')
      .expect('Content-Disposition', /filename="web1_var_log_syslog\.sanitized\.log"/)
      .expect(200)
      .end((err, res) => {
        res.body.should.equal('green\n\n');
        done(err);
      });
  });
});
