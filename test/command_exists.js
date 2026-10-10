'use strict';

const commandExists = require('../lib/command_exists');

describe('command_exists', () => {
  it('finds a command on PATH', () => {
    commandExists('node').should.be.true;
  });

  it('returns false for a missing command', () => {
    commandExists('definitely-not-a-real-command-xyz').should.be.false;
  });

  it('returns false with an empty PATH', () => {
    commandExists('node', { PATH: '' }).should.be.false;
  });
});
