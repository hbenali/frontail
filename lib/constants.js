'use strict';

module.exports = {
  // Above this size a "read from beginning" asks the user to confirm first.
  FILE_SIZE_WARNING_BYTES: 50 * 1024 * 1024,
  // A confirmed full read parses the whole file in memory only below this
  // size; a bigger one is streamed in pieces instead, so one huge log file
  // cannot take the server down.
  FULL_READ_IN_MEMORY_BYTES: 16 * 1024 * 1024,
  // Lines per `bulk-lines` message while a big file is streamed through.
  FULL_READ_CHUNK_LINES: 5000,
};
