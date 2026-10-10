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

  it('reassembles a tail error message split across stderr chunks', (done) => {
    const childProcess = require('child_process');
    const { PassThrough } = require('stream');
    const sinon = require('sinon');
    const { EventEmitter } = require('events');

    const cp = new EventEmitter();
    cp.stdout = new PassThrough();
    cp.stderr = new PassThrough();
    cp.kill = () => {};
    const spawn = sinon.stub(childProcess, 'spawn').returns(cp);

    const tailer = makeTail('/x/split.log', { buffer: 0 });
    spawn.restore();
    const errors = [];
    tailer.on('error', (e) => errors.push(e));

    cp.stderr.write("tail: cannot open '/x/split.log' for reading");
    cp.stderr.write(': No such file or directory\n');

    setTimeout(() => {
      errors.should.have.length(1);
      errors[0].message.should.equal(
        "cannot open '/x/split.log' for reading: No such file or directory"
      );
      done();
    }, 50);
  });

  describe('command source reconnect', () => {
    const childProcess = require('child_process');
    const { PassThrough } = require('stream');
    const { EventEmitter } = require('events');
    const sinon = require('sinon');

    let spawn;
    let children;

    const fakeChild = () => {
      const cp = new EventEmitter();
      cp.stdout = new PassThrough();
      cp.stderr = new PassThrough();
      cp.kill = () => {};
      children.push(cp);
      return cp;
    };

    beforeEach(() => {
      children = [];
      spawn = sinon.stub(childProcess, 'spawn').callsFake(fakeChild);
    });

    afterEach(() => {
      spawn.restore();
    });

    const opts = { buffer: 5, journal: true, reconnectBaseMs: 20, reconnectMaxMs: 80 };

    it('restarts a source that exits, resuming without replaying lines', (done) => {
      const tailer = makeTail([], opts);
      const errors = [];
      tailer.on('error', (e) => errors.push(e));

      spawn.callCount.should.equal(1);
      spawn.firstCall.args[1].should.containDeep(['-n', '5']);

      children[0].emit('close', 255);

      setTimeout(() => {
        spawn.callCount.should.equal(2);
        spawn.secondCall.args[1].should.containDeep(['-n', '0']);
        errors[0].message.should.match(/exited with code 255; reconnecting in/);
        done();
      }, 80);
    });

    it('streams lines from the restarted process', (done) => {
      const tailer = makeTail([], opts);
      const lines = [];
      tailer.on('line', (l) => lines.push(l.t));

      children[0].emit('close', 1);

      setTimeout(() => {
        children[1].stdout.write('after reconnect\n');
        setTimeout(() => {
          lines.should.eql(['after reconnect']);
          done();
        }, 30);
      }, 60);
    });

    it('keeps blank lines in the middle but drops the one flushed at stream end', (done) => {
      const tailer = makeTail([], opts);
      const lines = [];
      tailer.on('line', (l) => lines.push(l.t));

      children[0].stdout.write('a\n\nb\n');
      children[0].stdout.end();

      setTimeout(() => {
        lines.should.eql(['a', '', 'b']);
        done();
      }, 40);
    });

    it('backs off exponentially, up to the maximum', (done) => {
      const times = [];
      // Every process dies right after starting.
      spawn.callsFake(() => {
        times.push(Date.now());
        const cp = fakeChild();
        setImmediate(() => cp.emit('close', 1));
        return cp;
      });
      makeTail([], opts); // delays: 20ms, 40ms, 80ms, then capped at 80ms

      setTimeout(() => {
        const gaps = times.slice(1).map((t, i) => t - times[i]);
        gaps.length.should.be.aboveOrEqual(4);
        gaps[1].should.be.above(gaps[0]); // growing
        gaps[2].should.be.above(gaps[1]);
        gaps[3].should.be.below(gaps[2] + 40); // capped, not doubling again
        gaps[3].should.be.below(160);
        done();
      }, 600);
    });

    it('does not retry when the program cannot be started', (done) => {
      const tailer = makeTail([], opts);
      const errors = [];
      tailer.on('error', (e) => errors.push(e));

      const err = new Error('spawn journalctl ENOENT');
      children[0].emit('error', err);
      children[0].emit('close', -2);

      setTimeout(() => {
        spawn.callCount.should.equal(1);
        errors.should.have.length(1);
        errors[0].message.should.match(/Failed to run journalctl/);
        done();
      }, 100);
    });

    it('stops retrying once closed', (done) => {
      const tailer = makeTail([], opts);
      children[0].emit('close', 1);
      tailer.close();

      setTimeout(() => {
        spawn.callCount.should.equal(1);
        done();
      }, 100);
    });
  });
});
