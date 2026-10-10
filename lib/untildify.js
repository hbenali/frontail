'use strict';

const os = require('os');

/**
 * Expand a leading "~" to the user's home directory.
 */
module.exports = (filePath) => {
  const home = os.homedir();
  if (!home) return filePath;
  if (filePath === '~') return home;
  if (/^~[/\\]/.test(filePath)) return home + filePath.slice(1);
  return filePath;
};
