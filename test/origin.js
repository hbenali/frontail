'use strict';

const isOriginAllowed = require('../lib/origin');

describe('origin check', () => {
  it('allows requests without an Origin header (non-browser clients)', () => {
    isOriginAllowed(undefined, 'localhost:9001').should.be.true;
  });

  it('allows the same host, regardless of scheme or case', () => {
    isOriginAllowed('http://localhost:9001', 'localhost:9001').should.be.true;
    isOriginAllowed('https://Logs.Example.com', 'logs.example.com').should.be
      .true;
  });

  it('rejects another site', () => {
    isOriginAllowed('https://evil.example', 'localhost:9001').should.be.false;
  });

  it('rejects a different port on the same hostname', () => {
    isOriginAllowed('http://localhost:8080', 'localhost:9001').should.be.false;
  });

  it('rejects the null origin and malformed origins', () => {
    isOriginAllowed('null', 'localhost:9001').should.be.false;
    isOriginAllowed('not a url', 'localhost:9001').should.be.false;
  });

  it('rejects when the Host header is missing', () => {
    isOriginAllowed('http://localhost:9001', undefined).should.be.false;
  });

  it('allows explicitly configured origins (e.g. behind a proxy)', () => {
    const allowed = ['https://logs.example.com/'];

    isOriginAllowed('https://logs.example.com', 'internal:9001', allowed).should
      .be.true;
    isOriginAllowed('https://other.example.com', 'internal:9001', allowed)
      .should.be.false;
  });
});
