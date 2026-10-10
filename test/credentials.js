'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const resolveCredentials = require('../lib/credentials');

describe('credentials', () => {
  let dir;
  let file;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'frontail-cred-'));
    file = path.join(dir, 'pw');
    fs.writeFileSync(file, 's3cret\n');
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('uses flags', () => {
    resolveCredentials({ user: 'u', password: 'p' }, {}).should.eql({
      user: 'u',
      password: 'p',
    });
  });

  it('reads the password from a file, stripping the trailing newline', () => {
    resolveCredentials({ user: 'u', passwordFile: file }, {}).should.eql({
      user: 'u',
      password: 's3cret',
    });
  });

  it('falls back to environment variables', () => {
    resolveCredentials(
      {},
      { FRONTAIL_USER: 'eu', FRONTAIL_PASSWORD: 'ep' }
    ).should.eql({ user: 'eu', password: 'ep' });
  });

  it('prefers flag over file over env', () => {
    const env = { FRONTAIL_PASSWORD: 'env' };
    resolveCredentials({ passwordFile: file }, env).password.should.equal(
      's3cret'
    );
    resolveCredentials(
      { password: 'flag', passwordFile: file },
      env
    ).password.should.equal('flag');
  });

  it('returns false when nothing is set', () => {
    resolveCredentials({}, {}).should.eql({ user: false, password: false });
  });

  it('throws on an unreadable password file', () => {
    (() => resolveCredentials({ passwordFile: path.join(dir, 'nope') }, {}))
      .should.throw(/Cannot read password file/);
  });
});
