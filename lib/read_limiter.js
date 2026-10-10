'use strict';

/**
 * Caps how many full-log reads ("read from beginning") run at once across all
 * clients. Each one spawns a child process or opens a file stream, and any
 * browser can request them, so without a cap a single page could exhaust the
 * server.
 *
 * @param {number} [max] concurrent reads allowed
 */
module.exports = (max = 8) => {
  let active = 0;

  return {
    /**
     * @returns {(() => void) | null} a release function (safe to call more
     *   than once), or null when the server is at capacity
     */
    acquire() {
      if (active >= max) return null;
      active += 1;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        active -= 1;
      };
    },

    get active() {
      return active;
    },
  };
};
