'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const parseOptions = require('../lib/options_parser');

describe('options_parser --config', () => {
  let dir;
  let file;

  const writeConfig = (obj) => fs.writeFileSync(file, JSON.stringify(obj));
  const parse = (...extra) =>
    parseOptions(['node', 'frontail', '--config', file, ...extra]);

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'frontail-config-'));
    file = path.join(dir, 'frontail.json');
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('applies values from the file, camelCase or kebab-case', () => {
    writeConfig({ port: 1234, 'ui-hide-topbar': true, theme: 'dark' });

    const opts = parse('/a.log');

    opts.port.should.equal(1234);
    opts.uiHideTopbar.should.be.true;
    opts.theme.should.equal('dark');
  });

  it('lets command line flags win over the file', () => {
    writeConfig({ port: 1234 });

    parse('-p', '4321', '/a.log').port.should.equal(4321);
  });

  it('uses "files" when none are given on the command line', () => {
    writeConfig({ files: ['/a.log', '/b.log'] });

    parse().args.should.eql(['/a.log', '/b.log']);
    parse('/c.log').args.should.eql(['/c.log']);
  });

  it('rejects unknown keys', () => {
    writeConfig({ nope: 1 });

    (() => parse('/a.log')).should.throw(/Unknown option "nope"/);
  });

  it('throws on a missing config file', () => {
    fs.rmSync(file, { force: true });

    (() => parse('/a.log')).should.throw(/Cannot read config file/);
  });
});
