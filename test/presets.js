'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadHighlightPreset, loadColorsPreset } = require('../lib/presets');

describe('presets', () => {
  const presetDir = path.join(__dirname, '..', 'preset');
  let dir;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'frontail-presets-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  describe('loadHighlightPreset', () => {
    it('is undefined when highlighting is off', () => {
      (loadHighlightPreset({}, presetDir) === undefined).should.be.true;
    });

    it('loads the bundled default preset', () => {
      loadHighlightPreset({ uiHighlight: true }, presetDir).should.have.property('words');
    });

    it('loads a custom preset', () => {
      const file = path.join(dir, 'mine.json');
      fs.writeFileSync(file, JSON.stringify({ words: { x: 'color: red;' } }));

      loadHighlightPreset(
        { uiHighlight: true, uiHighlightPreset: file },
        presetDir
      ).should.eql({ words: { x: 'color: red;' } });
    });

    it('throws a readable error for a missing preset', () => {
      (() =>
        loadHighlightPreset(
          { uiHighlight: true, uiHighlightPreset: path.join(dir, 'nope.json') },
          presetDir
        )).should.throw(/Preset file .*nope\.json doesn't exists/);
    });
  });

  describe('loadColorsPreset', () => {
    it('is undefined without --ui-colors-preset', () => {
      (loadColorsPreset({}) === undefined).should.be.true;
    });

    it('loads rules from a file', () => {
      const file = path.join(dir, 'colors.json');
      fs.writeFileSync(file, JSON.stringify([{ regex: 'a', template: '{0}' }]));

      loadColorsPreset({ uiColorsPreset: file }).should.eql([
        { regex: 'a', template: '{0}' },
      ]);
    });

    it('throws a readable error for a missing file', () => {
      (() =>
        loadColorsPreset({ uiColorsPreset: path.join(dir, 'nope.json') }))
        .should.throw(/Colors preset file .*nope\.json doesn't exists/);
    });
  });
});
