'use strict';

const os = require('os');
const untildify = require('../lib/untildify');

describe('untildify', () => {
  it('expands a leading tilde', () => {
    untildify('~').should.equal(os.homedir());
    untildify('~/logs/a.log').should.equal(`${os.homedir()}/logs/a.log`);
  });

  it('leaves other paths alone', () => {
    untildify('/etc/a.log').should.equal('/etc/a.log');
    untildify('a/~/b').should.equal('a/~/b');
    untildify('~user/a').should.equal('~user/a');
  });
});
