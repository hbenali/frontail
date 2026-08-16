'use strict';

const sinon = require('sinon');
const childProcess = require('child_process');
const { PassThrough } = require('stream');
const EventEmitter = require('events');
const tail = require('../lib/tail');

describe('container log streaming', () => {
  let spawnStub;

  beforeEach(() => {
    spawnStub = sinon.stub(childProcess, 'spawn');
  });

  afterEach(() => {
    spawnStub.restore();
  });

  it('should spawn docker logs command when container is provided', (done) => {
    const cpMock = new EventEmitter();
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    cpMock.stdout = stdout;
    cpMock.stderr = stderr;
    cpMock.kill = sinon.spy();

    spawnStub.returns(cpMock);

    const tailer = tail([], {
      container: ['test-container'],
      containerEngine: 'docker',
      buffer: 10
    });

    tailer.on('line', (line) => {
      line.should.eql({ t: 'test log', s: 'test-container' });
      spawnStub.calledWith('docker', ['logs', '-f', '--tail', 10, 'test-container']).should.be.true;
      done();
    });

    stdout.write('test log\n');
  });

  it('should support multiple containers', (done) => {
    const cpMock1 = new EventEmitter();
    const stdout1 = new PassThrough();
    cpMock1.stdout = stdout1;
    cpMock1.stderr = new PassThrough();
    cpMock1.kill = sinon.spy();

    const cpMock2 = new EventEmitter();
    const stdout2 = new PassThrough();
    cpMock2.stdout = stdout2;
    cpMock2.stderr = new PassThrough();
    cpMock2.kill = sinon.spy();

    spawnStub.withArgs('podman', ['logs', '-f', '--tail', 5, 'c1']).returns(cpMock1);
    spawnStub.withArgs('podman', ['logs', '-f', '--tail', 5, 'c2']).returns(cpMock2);

    const tailer = tail([], {
      container: ['c1', 'c2'],
      containerEngine: 'podman',
      buffer: 5
    });

    const lines = [];
    tailer.on('line', (line) => {
      lines.push(line);
      if (lines.length === 2) {
        spawnStub.calledWith('podman', ['logs', '-f', '--tail', 5, 'c1']).should.be.true;
        spawnStub.calledWith('podman', ['logs', '-f', '--tail', 5, 'c2']).should.be.true;
        lines.should.containEql({ t: 'log from c1', s: 'c1' });
        lines.should.containEql({ t: 'log from c2', s: 'c2' });
        done();
      }
    });

    stdout1.write('log from c1\n');
    stdout2.write('log from c2\n');
  });

  it('should emit error when container stderr outputs', (done) => {
    const cpMock = new EventEmitter();
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    cpMock.stdout = stdout;
    cpMock.stderr = stderr;
    cpMock.kill = sinon.spy();

    spawnStub.returns(cpMock);

    const tailer = tail([], {
      container: ['bad-container'],
      containerEngine: 'docker',
      buffer: 10
    });

    tailer.on('error', (err) => {
      err.container.should.equal('bad-container');
      err.message.should.equal('No such container');
      done();
    });

    stderr.write('No such container\n');
  });

  it('should kill all child processes on close()', () => {
    const cpMock = new EventEmitter();
    cpMock.stdout = new PassThrough();
    cpMock.stderr = new PassThrough();
    cpMock.kill = sinon.spy();

    spawnStub.returns(cpMock);

    const tailer = tail([], {
      container: ['test-container'],
      containerEngine: 'docker',
      buffer: 10
    });

    tailer.close();

    cpMock.kill.calledOnce.should.be.true;
  });

  it('should call onEnd after readFromStart finishes', (done) => {
    const followCp = new EventEmitter();
    followCp.stdout = new PassThrough();
    followCp.stderr = new PassThrough();
    followCp.kill = sinon.spy();

    const readCp = new EventEmitter();
    const readStdout = new PassThrough();
    readCp.stdout = readStdout;
    readCp.stderr = new PassThrough();
    readCp.kill = sinon.spy();

    spawnStub.withArgs('docker', ['logs', '-f', '--tail', 10, 'test-container']).returns(followCp);
    spawnStub.withArgs('docker', ['logs', 'test-container']).returns(readCp);

    const tailer = tail([], {
      container: ['test-container'],
      containerEngine: 'docker',
      buffer: 10
    });

    const lines = [];
    tailer.readFromStart(0,
      (line) => lines.push(line),
      () => {
        lines.should.eql([{ t: 'line1', s: 'test-container' }, { t: 'line2', s: 'test-container' }]);
        done();
      }
    );

    readStdout.write('line1\nline2');
    readStdout.end();
  });

  it('should return source list via getSources()', () => {
    const cpMock = new EventEmitter();
    cpMock.stdout = new PassThrough();
    cpMock.stderr = new PassThrough();
    cpMock.kill = sinon.spy();
    spawnStub.returns(cpMock);

    const tailer = tail([], {
      container: ['web', 'db'],
      containerEngine: 'docker',
      buffer: 10
    });

    tailer.getSources().should.eql([
      { name: 'web', type: 'container' },
      { name: 'db', type: 'container' }
    ]);
  });

  it('should tail both files and containers simultaneously', (done) => {
    const containerCp = new EventEmitter();
    const containerStdout = new PassThrough();
    containerCp.stdout = containerStdout;
    containerCp.stderr = new PassThrough();
    containerCp.kill = sinon.spy();

    const fileCp = new EventEmitter();
    const fileStdout = new PassThrough();
    fileCp.stdout = fileStdout;
    fileCp.stderr = new PassThrough();
    fileCp.kill = sinon.spy();

    spawnStub.withArgs('docker', ['logs', '-f', '--tail', 10, 'myapp']).returns(containerCp);
    spawnStub.withArgs('tail', ['-n', 10, '-F', '/var/log/app.log']).returns(fileCp);

    const tailer = tail(['/var/log/app.log'], {
      container: ['myapp'],
      containerEngine: 'docker',
      buffer: 10
    });

    tailer.getSources().should.eql([
      { name: 'myapp', type: 'container' },
      { name: '/var/log/app.log', type: 'file' }
    ]);

    const lines = [];
    tailer.on('line', (line) => {
      lines.push(line);
      if (lines.length === 2) {
        lines.should.containEql({ t: 'container log', s: 'myapp' });
        lines.should.containEql({ t: 'file log', s: '/var/log/app.log' });
        done();
      }
    });

    containerStdout.write('container log\n');
    fileStdout.write('file log\n');
  });

  it('should normalize path string to array', (done) => {
    const cpMock = new EventEmitter();
    const stdout = new PassThrough();
    cpMock.stdout = stdout;
    cpMock.stderr = new PassThrough();
    cpMock.kill = sinon.spy();

    spawnStub.returns(cpMock);

    const tailer = tail('/some/file.log', { buffer: 5 });

    tailer.on('line', (line) => {
      line.should.have.property('t', 'test');
      line.should.have.property('s', '/some/file.log');
      done();
    });

    stdout.write('test\n');
  });
});
