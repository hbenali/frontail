'use strict';

// Directory-backed log sources: instead of listing every log file on the
// command line, mount a volume with logs and let the files inside it become
// sources. The walk is bounded on purpose - a mounted volume can contain
// thousands of files and a few multi-gigabyte databases that must never be
// tailed by accident.

const fs = require('fs');
const path = require('path');

const DEFAULT_MAX_DEPTH = 3;
const DEFAULT_MAX_FILES = 200;
// A file is dropped when statSync cannot read it, it is empty, an archive, or
// binary. Size is not a reason any more: the browser warns before a full read
// of a file over FILE_SIZE_WARNING_BYTES and only the reader decides, so a
// file that is silently left out here would never be offered to them at all.
// Compressed and rotated archives are not logs we can stream as text.
const SKIP_RX = /\.(gz|bz2|xz|zip|zst|lz4|7z)$/i;
const SNIFF_BYTES = 4096;

/**
 * A file is treated as text unless its first block contains a NUL byte.
 * Cheap heuristic, same one `grep` uses, and good enough to keep databases
 * and images out of the source list.
 *
 * @param {string} filePath
 * @returns {boolean} true when the file looks binary
 */
function looksBinary(filePath) {
  let fd;
  try {
    fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(SNIFF_BYTES);
    const read = fs.readSync(fd, buf, 0, SNIFF_BYTES, 0);
    return buf.subarray(0, read).includes(0);
  } catch {
    return true;
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch {
        /* the descriptor is already gone */
      }
    }
  }
}

/**
 * Resolves a discovered file so the tree and the tailer agree on one spelling.
 * statSync above already followed the link; this makes the path itself absolute.
 *
 * @param {string} filePath
 * @returns {string}
 */
function realpathFile(filePath) {
  try {
    return fs.realpathSync(filePath);
  } catch {
    return filePath;
  }
}

/**
 * Walks one directory and pushes the log files it finds into `acc`.
 *
 * @param {string} dirPath
 * @param {{ maxDepth: number, maxFiles: number, stats: { skipped: number } }} opts
 * @param {string[]} acc
 * @param {number} depth
 * @param {Set<string>} seen real paths of visited directories (symlink loops)
 */
function walk(dirPath, opts, acc, depth, seen) {
  if (depth > opts.maxDepth || acc.length >= opts.maxFiles) return;

  let real;
  let entries;
  try {
    real = fs.realpathSync(dirPath);
    if (seen.has(real)) return;
    seen.add(real);
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    opts.stats.skipped += 1;
    return;
  }

  entries.sort((a, b) => a.name.localeCompare(b.name));

  entries.forEach((entry) => {
    if (acc.length >= opts.maxFiles) return;
    if (entry.name.startsWith('.')) return;

    const fullPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      walk(fullPath, opts, acc, depth + 1, seen);
      return;
    }

    // Symlinks are resolved by the statSync below; a dangling one is skipped.
    let stat;
    try {
      stat = fs.statSync(fullPath);
    } catch {
      opts.stats.skipped += 1;
      return;
    }
    if (!stat.isFile()) return;
    if (SKIP_RX.test(entry.name)) {
      opts.stats.skipped += 1;
      return;
    }
    if (stat.size === 0) {
      opts.stats.skipped += 1;
      return;
    }
    if (looksBinary(fullPath)) {
      opts.stats.skipped += 1;
      return;
    }
    acc.push(realpathFile(fullPath));
  });
}

/**
 * Expands `--dir` values into the list of log files they contain.
 *
 * @param {string[]} dirs directories from the command line / config file
 * @param {{ maxDepth?: number, maxFiles?: number }} [options]
 * @returns {{ files: string[], skipped: number }}
 */
function expandLogDirs(dirs, options) {
  const opts = {
    maxDepth: (options && options.maxDepth) || DEFAULT_MAX_DEPTH,
    maxFiles: (options && options.maxFiles) || DEFAULT_MAX_FILES,
    stats: { skipped: 0 },
  };
  const files = [];
  const seen = new Set();

  (dirs || []).forEach((dir) => {
    walk(path.resolve(dir), opts, files, 0, seen);
  });

  return { files, skipped: opts.stats.skipped };
}

/**
 * Groups the files discovered under each configured directory into a tree the
 * settings UI can render: one entry per directory, with the files it yielded and
 * the index each file has in the global sources list.
 *
 * @param {string[]} dirs
 * @param {string[]} allFiles every source in the order the tailer will see them
 * @returns {Array<{dir: string, name: string, files: Array<{path: string, name: string, fileIndex: number}>}>}
 */
function buildDirView(dirs, allFiles) {
  if (!Array.isArray(dirs) || dirs.length === 0) {
    return [];
  }
  const sources = Array.isArray(allFiles) ? allFiles : [];
  return dirs.map((dir) => {
    let resolved = path.resolve(dir);
    try {
      resolved = fs.realpathSync(resolved);
    } catch {
      /* a directory that vanished just keeps its configured spelling */
    }
    const files = [];
    for (let i = 0; i < sources.length; i += 1) {
      const source = sources[i];
      const rel = path.relative(resolved, path.resolve(source));
      if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
        continue;
      }
      files.push({ path: source, name: path.basename(source), fileIndex: i });
    }
    return { dir: resolved, name: path.basename(resolved) || resolved, files };
  });
}

module.exports = { buildDirView, expandLogDirs, DEFAULT_MAX_DEPTH, DEFAULT_MAX_FILES };
