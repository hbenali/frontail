'use strict';

const fs = require('fs');
const path = require('path');
const untildify = require('./untildify');

function readJson(file, label) {
  if (!fs.existsSync(file)) {
    throw new Error(`${label} ${file} doesn't exists`);
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/**
 * Keyword/line highlight preset for --ui-highlight (default preset when no
 * --ui-highlight-preset is given), or undefined when highlighting is off.
 *
 * @param {import('./options_parser').Options} options
 * @param {string} presetDir directory holding the bundled presets
 */
function loadHighlightPreset(options, presetDir) {
  if (!options.uiHighlight) return undefined;

  const file = options.uiHighlightPreset
    ? path.resolve(untildify(options.uiHighlightPreset))
    : path.join(presetDir, 'default.json');
  return readJson(file, 'Preset file');
}

/**
 * Extra log-colorizing rules for --ui-colors-preset, or undefined.
 *
 * @param {import('./options_parser').Options} options
 */
function loadColorsPreset(options) {
  if (!options.uiColorsPreset) return undefined;

  return readJson(
    path.resolve(untildify(options.uiColorsPreset)),
    'Colors preset file'
  );
}

module.exports = { loadHighlightPreset, loadColorsPreset };
