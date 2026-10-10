'use strict';

const daemon = require('daemon-fix41');
const sinon = require('sinon');
const fs = require('fs');
const optionsParser = require('../lib/options_parser');
const daemonize = require('../lib/daemonize');

describe('daemonize', () => {
  let opts;

  beforeEach(() => {
    opts = optionsParser(['node', '/path/to/frontail']);
    sinon.stub(daemon, 'daemon');
    daemon.daemon.returns({
      pid: 1000,
    });
    sinon.stub(fs, 'writeFileSync');
    sinon.stub(fs, 'openSync');
  });

  afterEach(() => {
    daemon.daemon.restore();
    fs.writeFileSync.restore();
    fs.openSync.restore();
  });

  describe('should daemon', () => {
    it('current script', () => {
      daemonize('script', opts);

      daemon.daemon.lastCall.args[0].should.match('script');
    });

    it('with hostname', () => {
      opts = optionsParser(['node', '/path/to/frontail', '-h', '127.0.0.1']);

      daemonize('script', opts);

      daemon.daemon.lastCall.args[1].should.containDeep(['-h', '127.0.0.1']);
    });

    it('with port', () => {
      opts = optionsParser(['node', '/path/to/frontail', '-p', '80']);

      daemonize('script', opts);

      daemon.daemon.lastCall.args[1].should.containDeep(['-p', 80]);
    });

    it('with lines number', () => {
      opts = optionsParser(['node', '/path/to/frontail', '-n', '1']);

      daemonize('script', opts);

      daemon.daemon.lastCall.args[1].should.containDeep(['-n', 1]);
    });

    it('with lines stored in browser', () => {
      opts = optionsParser(['node', '/path/to/frontail', '-l', '1']);

      daemonize('script', opts);

      daemon.daemon.lastCall.args[1].should.containDeep(['-l', 1]);
    });

    it('with theme', () => {
      opts = optionsParser(['node', '/path/to/frontail', '-t', 'dark']);

      daemonize('script', opts);

      daemon.daemon.lastCall.args[1].should.containDeep(['-t', 'dark']);
    });

    it('with authorization, passing credentials via env not argv', () => {
      opts = optionsParser([
        'node',
        '/path/to/frontail',
        '-U',
        'user',
        '-P',
        'passw0rd',
      ]);

      daemonize('script', opts, {
        doAuthorization: true,
      });

      const { lastCall } = daemon.daemon;
      lastCall.args[1].should.not.containEql('passw0rd');
      lastCall.args[1].should.not.containEql('-P');
      lastCall.args[2].env.FRONTAIL_USER.should.equal('user');
      lastCall.args[2].env.FRONTAIL_PASSWORD.should.equal('passw0rd');
    });

    it('with authorization from resolved credentials', () => {
      daemonize('script', opts, {
        doAuthorization: true,
        credentials: { user: 'bob', password: 'from-file' },
      });

      const { env } = daemon.daemon.lastCall.args[2];
      env.FRONTAIL_USER.should.equal('bob');
      env.FRONTAIL_PASSWORD.should.equal('from-file');
    });

    it('without authorization if option doAuthorization not passed', () => {
      opts = optionsParser([
        'node',
        '/path/to/frontail',
        '-U',
        'user',
        '-P',
        'passw0rd',
      ]);

      daemonize('script', opts);

      daemon.daemon.lastCall.args[2].should.not.have.property('env');
    });

    it('with secure connection', () => {
      opts = optionsParser([
        'node',
        '/path/to/frontail',
        '-k',
        'key.file',
        '-c',
        'cert.file',
      ]);

      daemonize('script', opts, {
        doSecure: true,
      });

      daemon.daemon.lastCall.args[1].should.containDeep([
        '-k',
        'key.file',
        '-c',
        'cert.file',
      ]);
    });

    it('without secure connection if option doSecure not passed', () => {
      opts = optionsParser([
        'node',
        '/path/to/frontail',
        '-k',
        'key.file',
        '-c',
        'cert.file',
      ]);

      daemonize('script', opts, {
        doSecure: true,
      });

      daemon.daemon.lastCall.args[1].should.containDeep([
        '-k',
        'key.file',
        '-c',
        'cert.file',
      ]);
    });

    it('with url-path option', () => {
      opts = optionsParser(['node', '/path/to/frontail', '--url-path', '/test']);

      daemonize('script', opts);

      daemon.daemon.lastCall.args[1].should.containDeep([
        '--url-path',
        '/test',
      ]);
    });

    it('with hide-topbar option', () => {
      opts = optionsParser(['node', '/path/to/frontail', '--ui-hide-topbar']);

      daemonize('script', opts);

      daemon.daemon.lastCall.args[1].should.containDeep(['--ui-hide-topbar']);
    });

    it('with no-indent option', () => {
      opts = optionsParser(['node', '/path/to/frontail', '--ui-no-indent']);

      daemonize('script', opts);

      daemon.daemon.lastCall.args[1].should.containDeep(['--ui-no-indent']);
    });

    it('with highlight option', () => {
      opts = optionsParser(['node', '/path/to/frontail', '--ui-highlight']);

      daemonize('script', opts);

      daemon.daemon.lastCall.args[1].should.containDeep(['--ui-highlight']);
    });

    it('with highlight preset option', () => {
      opts = optionsParser([
        'node',
        '/path/to/frontail',
        '--ui-highlight',
        '--ui-highlight-preset',
        'test.json',
      ]);

      daemonize('script', opts);

      daemon.daemon.lastCall.args[1].should.containDeep([
        '--ui-highlight-preset',
        'test.json',
      ]);
    });

    it('with file to tail', () => {
      opts = optionsParser(['node', '/path/to/frontail', '/path/to/file']);

      daemonize('script', opts);

      daemon.daemon.lastCall.args[1].should.containDeep(['/path/to/file']);
    });
  });

  it('should write pid to pidfile', () => {
    opts = optionsParser([
      'node',
      '/path/to/frontail',
      '--pid-path',
      '/path/to/pid',
    ]);

    daemonize('script', opts);

    fs.writeFileSync.lastCall.args[0].should.be.equal('/path/to/pid');
    fs.writeFileSync.lastCall.args[1].should.be.equal(1000);
  });

  it('should log to file', () => {
    opts = optionsParser([
      'node',
      '/path/to/frontail',
      '--log-path',
      '/path/to/log',
    ]);
    fs.openSync.returns('file');

    daemonize('script', opts);

    fs.openSync.lastCall.args[0].should.equal('/path/to/log');
    fs.openSync.lastCall.args[1].should.equal('a');
    daemon.daemon.lastCall.args[2].should.eql({
      stdout: 'file',
      stderr: 'file',
    });
  });
});
