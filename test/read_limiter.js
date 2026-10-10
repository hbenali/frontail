'use strict';

const createReadLimiter = require('../lib/read_limiter');

describe('read limiter', () => {
  it('grants up to the limit, then refuses', () => {
    const limiter = createReadLimiter(2);

    const a = limiter.acquire();
    const b = limiter.acquire();

    a.should.be.a.Function;
    b.should.be.a.Function;
    (limiter.acquire() === null).should.be.true;
    limiter.active.should.equal(2);
  });

  it('frees a slot on release', () => {
    const limiter = createReadLimiter(1);
    const release = limiter.acquire();

    release();

    limiter.active.should.equal(0);
    limiter.acquire().should.be.a.Function;
  });

  it('ignores a repeated release', () => {
    const limiter = createReadLimiter(2);
    const release = limiter.acquire();
    limiter.acquire();

    release();
    release();

    limiter.active.should.equal(1);
  });
});
