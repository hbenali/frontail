'use strict';

const fs = require('fs');
const temp = require('temp');
const tail = require('../lib/tail');

const TEMP_FILE_PROFIX = '';
const SPAWN_DELAY = 10;

function writeLines(fd, count) {
  for (let i = 0; i < count; i += 1) {
    fs.writeSync(
      fd,
      `line${i}
`
    );
  }
  fs.closeSync(fd);
}

describe('tail', () => {
  temp.track();

  // Close every tailer a test creates so child processes and `process` exit
  // listeners don't pile up across tests.
  const opened = [];
  const makeTail = (...args) => {
    const t = tail(...args);
    opened.push(t);
    return t;
  };

  afterEach(() => {
    opened.splice(0).forEach((t) => t.close());
  });

  it('calls event line if new line appear in file', (done) => {
    temp.open(TEMP_FILE_PROFIX, (err, info) => {
      makeTail(info.path).on('line', (line) => {
        line.should.have.property('t', 'line0');
        line.should.have.property('s', info.path);
        done();
      });

      setTimeout(writeLines, SPAWN_DELAY, info.fd, 1);
    });
  });

  it('buffers lines on start', (done) => {
    temp.open(TEMP_FILE_PROFIX, (err, info) => {
      writeLines(info.fd, 20);

      const tailer = makeTail(info.path, {
        buffer: 2,
      });
      setTimeout(() => {
        tailer.getBuffer().should.be.eql([
          { t: 'line18', s: info.path },
          { t: 'line19', s: info.path }
        ]);
        done();
      }, SPAWN_DELAY);
    });
  });

  it('buffers no lines on start by default', (done) => {
    temp.open(TEMP_FILE_PROFIX, (err, info) => {
      writeLines(info.fd, 3);

      const tailer = makeTail(info.path);
      setTimeout(() => {
        tailer.getBuffer().should.be.empty;
        done();
      }, SPAWN_DELAY);
    });
  });

  it('removes its process exit listener on close', () => {
    const before = process.listenerCount('exit');
    const tailer = tail([]);

    process.listenerCount('exit').should.equal(before + 1);
    tailer.close();
    process.listenerCount('exit').should.equal(before);
  });

  it('readFromStart streams the whole file then ends', (done) => {
    temp.open(TEMP_FILE_PROFIX, (err, info) => {
      writeLines(info.fd, 5);
      const tailer = makeTail(info.path, { buffer: 0 });
      const lines = [];

      tailer.readFromStart(
        0,
        (line) => lines.push(line.t),
        () => {
          lines.should.eql(['line0', 'line1', 'line2', 'line3', 'line4']);
          done();
        }
      );
    });
  });

  it('readFromStart can be cancelled and then never calls back', (done) => {
    temp.open(TEMP_FILE_PROFIX, (err, info) => {
      writeLines(info.fd, 5000);
      const tailer = makeTail(info.path, { buffer: 0 });
      let calls = 0;

      const cancel = tailer.readFromStart(
        0,
        () => {
          calls += 1;
        },
        () => {
          calls += 1000;
        }
      );
      cancel();

      setTimeout(() => {
        calls.should.equal(0);
        done();
      }, 100);
    });
  });

  it('readFromStart ends when the file is unreadable', (done) => {
    const tailer = makeTail(['/definitely/not/here.log'], { buffer: 0 });

    tailer.readFromStart(0, () => {}, done);
  });

  it('readFromStart returns a no-op cancel for an unknown source', () => {
    const tailer = makeTail([], { buffer: 0 });

    tailer.readFromStart(3, () => {}, () => {}).should.be.a.Function;
  });

  it('reports a missing file as an error instead of failing silently', (done) => {
    const missing = '/definitely/not/here/syslog';
    const tailer = makeTail(missing, { buffer: 0 });

    tailer.on('error', (err) => {
      err.source.should.equal(missing);
      err.message.should.match(/cannot open.*No such file or directory/);
      tailer.getErrors().should.have.length(1);
      done();
    });
  });

  it('reports an unreadable file (permission denied)', function unreadable(done) {
    if (process.getuid && process.getuid() === 0) return this.skip();
    temp.open(TEMP_FILE_PROFIX, (err, info) => {
      fs.closeSync(info.fd);
      fs.chmodSync(info.path, 0o000);
      const tailer = makeTail(info.path, { buffer: 0 });

      tailer.on('error', (e) => {
        e.source.should.equal(info.path);
        e.message.should.match(/Permission denied/);
        done();
      });
    });
    return undefined;
  });

  it('does not report the same file error twice in a row', (done) => {
    const missing = '/definitely/not/here/again';
    const tailer = makeTail(missing, { buffer: 0 });
    const errors = [];

    tailer.on('error', (e) => {
      errors.push(e);
      // Give a duplicate time to (wrongly) show up after the first report.
      if (errors.length === 1) {
        setTimeout(() => {
          errors.should.have.length(1);
          done();
        }, 300);
      }
    });
  });

  it('does not throw for a bad file when nobody listens for errors', (done) => {
    makeTail('/definitely/not/here/silent', { buffer: 0 });

    setTimeout(done, 200);
  });
});
