'use strict';

const fs = require('fs');
const readline = require('readline');
const { FILE_SIZE_WARNING_BYTES, FULL_READ_IN_MEMORY_BYTES, FULL_READ_CHUNK_LINES } = require('./constants');

// A plain "show me this log" must never stream a multi-hundred-MB file:
// the browser cannot paint that and the tab dies. Only an explicit full=1
// (the "load anyway" confirmation) reads a file from byte zero.

/**
 * Builds the line sent to browsers for a tail/source error.
 * @param {{ source?: string, container?: string, message: string }} err
 */
const errorText = (err) =>
  `[frontail] ${err.source || err.container}: ${err.message}`;

/**
 * Wires the log namespace: what a connecting browser is sent (options, the
 * buffered lines, earlier errors) and how it can ask for a source's full
 * history ("read from beginning").
 *
 * @param {object} deps
 * @param {import('socket.io').Server} deps.io
 * @param {string} deps.namespace namespace name without the leading slash
 * @param {ReturnType<typeof import('./tail')>} deps.tailer
 * @param {import('./options_parser').Options} deps.options
 * @param {Array<{ dir: string, name: string, files: Array<{ path: string, name: string, fileIndex: number }> }>} [deps.logDirs]
 *   directories the UI groups its sources under
 * @param {{ highlightConfig?: object, colorsPreset?: object[] }} deps.presets
 * @param {string} deps.version
 * @param {ReturnType<typeof import('./read_limiter')>} deps.readLimiter
 * @param {(socket: import('socket.io').Socket, next: (err?: Error) => void) => void} [deps.requireSession]
 *   socket.io middleware guarding the namespace (set when Basic Auth is on)
 * @returns {import('socket.io').Namespace}
 */
function attachLogSocket({
  io,
  namespace,
  tailer,
  options,
  logDirs,
  presets,
  version,
  readLimiter,
  requireSession,
  onRefreshLogDirs,
}) {
  const nsp = io.of(`/${namespace}`);
  let currentLogDirs = logDirs || [];
  if (requireSession) {
    nsp.use(requireSession);
  }

  // One follower shared by every browser: it is spawned for the first
  // viewer and killed when the last one goes away, so an idle frontail
  // runs no tail at all instead of one per file forever.
  let followers = 0;
  const acquire = () => {
    followers += 1;
    if (followers === 1 && typeof tailer.start === 'function') {
      tailer.start();
    }
  };
  const release = () => {
    followers -= 1;
    if (followers <= 0) {
      followers = 0;
      if (typeof tailer.stop === 'function') {
        tailer.stop();
      }
    }
  };

  nsp.on('connection', (socket) => {
    acquire();
    socket.on('disconnect', release);
    socket.emit('options:lines', options.lines);
    socket.emit('options:version', version);

    if (options.uiHideTopbar) {
      socket.emit('options:hide-topbar');
    }

    // These flags are plain booleans (unset unless passed). Commander < 4
    // treated any "-no-" flag as a negation defaulting to true, which the
    // old inverted checks relied on.
    if (options.uiNoIndent) {
      socket.emit('options:no-indent');
    }

    if (options.uiNoColors) {
      socket.emit('options:no-colors');
    }

    if (options.uiHighlight) {
      socket.emit('options:highlightConfig', presets.highlightConfig);
    }

    if (presets.colorsPreset) {
      socket.emit('options:colorsPreset', presets.colorsPreset);
    }

    socket.emit('options:sources', tailer.getSources());
    socket.emit('options:log-dirs', currentLogDirs);

    socket.emit('options:source-info', {
      isContainer: tailer.getSources().some((src) => src.type !== 'file'),
    });

    tailer.getBuffer().forEach((line) => {
      socket.emit('line', line);
    });

    tailer.getErrors().forEach((err) => {
      socket.emit('line', { t: errorText(err), s: null });
    });

    // Reads started by this socket; cancelled on disconnect so a client that
    // goes away mid-download doesn't leave a child process or file stream.
    const activeReads = new Set();
    // Rows per socket message; big enough to skip per-row rendering, small
    // enough to keep the first screen appearing instantly.
    const BULK_CHUNK_SIZE = 500;
    const startRead = (fileIndex, maxLines, seq) => {
      // A new request replaces this socket's previous read (e.g. the user
      // switched source), so one client can never hold more than one.
      activeReads.forEach((stop) => stop());
      activeReads.clear();

      const release = readLimiter.acquire();
      if (!release) {
        socket.emit('line', {
          t: '[frontail] too many full-log reads in progress, try again in a moment',
          s: null,
        });
        socket.emit('read-end', { seq: seq });
        return;
      }

      // Backfill rows go out in batches so the browser can keep them as plain
      // text and colour only what reaches the viewport. Emitting one 'line' per
      // row made a 5k-row start paint every row at once.
      // Rows have to keep their source name: the page drops rows that do not
      // match the selected source, so a null name made a single-source "Start"
      // arrive and be filtered away, leaving the pane empty.
      const source = tailer.getSources()[fileIndex];
      const sourceName = source ? source.name : null;
      const chunk = [];
      const flushChunk = () => {
        if (!chunk.length) return;
        socket.emit('bulk-lines', { lines: chunk.slice(), s: sourceName, seq: seq });
        chunk.length = 0;
      };
      // The single-source backfill clears the pane too, so a "Start" right
      // after a "Start X" does not stack two slices on top of each other.
      socket.emit('file-start-info', { size: 0, tooLarge: false, isContainer: false, seq: seq });
      const cancel = tailer.readFromStart(
        fileIndex,
        (line) => {
          chunk.push(line && line.t !== undefined ? line.t : String(line));
          if (chunk.length >= BULK_CHUNK_SIZE) flushChunk();
        },
        () => {
          flushChunk();
          activeReads.delete(stop);
          release();
          socket.emit('read-end', { seq: seq });
        },
        maxLines
      );
      const stop = () => {
        release();
        cancel();
      };
      activeReads.add(stop);
    };

    // "All sources" asks for the tail of every switched-on file at once. The
    // files are walked one after another inside a single read slot, because a
    // socket keeps only one active reader.
    const startReadMany = (indexes, perFile, seq) => {
      activeReads.forEach((stop) => stop());
      activeReads.clear();

      const release = readLimiter.acquire();
      if (!release) {
        socket.emit('line', {
          t: '[frontail] too many full-log reads in progress, try again in a moment',
          s: null,
        });
        socket.emit('read-end', { seq: seq });
        return;
      }

      const sources = tailer.getSources();
      const queue = indexes.filter((index) => sources[index]);
      const inFlight = new Set();
      let cancelled = false;
      let finished = false;
      let cursor = 0;

      const finish = (superseded) => {
        if (finished) return;
        finished = true;
        activeReads.delete(stop);
        release();
        // A cancelled read must stay silent: its read-end would otherwise be
        // taken as the end of the read that replaced it.
        if (!superseded) socket.emit('read-end', { seq: seq });
      };

      // Each file costs a tail process, so walking 200 sources one by one took
      // seconds on the big directories. A small pool keeps the socket busy and
      // still bounds the number of processes the container has to spawn.
      const CONCURRENT_READS = 32;

      const pump = () => {
        while (!cancelled && inFlight.size < CONCURRENT_READS && cursor < queue.length) {
          const index = queue[cursor++];
          const sourceName = sources[index].name;
          // Lines of one file are shipped as bulk chunks instead of single
          // events: the browser renders bulk rows as plain text and paints
          // only what reaches the viewport, which is what keeps a several
          // thousand line slice cheap.
          let chunk = [];
          const flushChunk = () => {
            if (cancelled || !chunk.length) return;
            socket.emit('bulk-lines', { lines: chunk, s: sourceName, seq: seq });
            chunk = [];
          };
          const cancelRead = tailer.readFromStart(
            index,
            (line) => {
              if (cancelled) return;
              chunk.push(line.t === undefined ? String(line) : line.t);
              if (chunk.length >= BULK_CHUNK_SIZE) flushChunk();
            },
            () => {
              flushChunk();
              inFlight.delete(cancelRead);
              if (cancelled) return;
              if (inFlight.size === 0 && cursor >= queue.length) finish(false);
              else pump();
            },
            perFile
          );
          inFlight.add(cancelRead);
        }
        if (!cancelled && inFlight.size === 0 && cursor >= queue.length) finish(false);
      };

      const stop = () => {
        cancelled = true;
        inFlight.forEach((cancelRead) => cancelRead());
        inFlight.clear();
        finish(true);
      };

      activeReads.add(stop);
      pump();
    };

// Below this size the whole file is read in one go: a single parse is
    // faster than a stream, and the text fits comfortably in memory.
    const fullReadFitsInMemory = (source) => {
      try {
        return fs.statSync(source.name).size <= FULL_READ_IN_MEMORY_BYTES;
      } catch (unreadable) {
        void unreadable;
        // Let the plain read below report what is wrong with the file.
        return true;
      }
    };

    // A full read is delivered in chunks: the snapshot lands as one or more
    // `bulk-lines` events, and live lines keep coming from the normal tail.
    // A file small enough is parsed in one go; anything bigger is streamed
    // line by line. Reading a multi-gigabyte log into one string is what the
    // server cannot survive: it needs the whole file twice over.
    const readWholeFile = (source, seq) => {
      const release = readLimiter.acquire();
      if (!release) {
        socket.emit('line', {
          t: '[frontail] too many full-log reads in progress, try again in a moment',
          s: null,
        });
        socket.emit('read-end', { seq: seq });
        return;
      }

      if (!fullReadFitsInMemory(source)) {
        readWholeFileStreaming(source, seq, release);
        return;
      }

      fs.readFile(source.name, 'utf8', (err, text) => {
        release();
        if (err) {
          socket.emit('line', {
            t: errorText({ source: source.name, message: err.message }),
            s: null,
          });
          socket.emit('read-end', { seq: seq });
          return;
        }
        const lines = text.split(/\r?\n/);
        if (lines.length && lines[lines.length - 1] === '') lines.pop();
        socket.emit('bulk-lines', { lines: lines, s: source.name, seq: seq });
        socket.emit('read-end', { seq: seq });
      });
    };

    // Streams a file too big to hold in memory, in `FULL_READ_CHUNK_LINES`
    // pieces so the browser keeps painting while the rest arrives.
    const readWholeFileStreaming = (source, seq, release) => {
      const input = fs.createReadStream(source.name, { encoding: 'utf8' });
      const rl = readline.createInterface({ input, crlfDelay: Infinity });
      let chunk = [];
      let finished = false;
      let disconnected = false;

      const emitChunk = () => {
        if (!chunk.length) return;
        socket.emit('bulk-lines', { lines: chunk, s: source.name, seq: seq });
        chunk = [];
      };

      const finish = (err) => {
        if (finished || disconnected) return;
        finished = true;
        release();
        if (err) {
          rl.close();
          input.destroy();
          socket.emit('line', {
            t: errorText({ source: source.name, message: err.message }),
            s: null,
          });
        } else {
          emitChunk();
        }
        socket.emit('read-end', { seq: seq });
      };

      rl.on('line', (line) => {
        if (finished || disconnected) return;
        chunk.push(line);
        if (chunk.length >= FULL_READ_CHUNK_LINES) emitChunk();
      });
      rl.on('close', () => finish(null));
      // A missing/unreadable file errors on the stream, not on the interface.
      input.on('error', (err) => finish(err));
      rl.on('error', (err) => finish(err));

      // The socket asked for the whole file and then closed: drop the read so
      // it stops holding a slot of the global limiter.
      socket.once('disconnect', () => {
        if (finished || disconnected) return;
        disconnected = true;
        release();
        rl.close();
        input.destroy();
      });
    };

    socket.on('disconnect', () => {
      activeReads.forEach((stop) => stop());
      activeReads.clear();
    });

    // Client asks for a source's history. `lines` (optional) caps the read to
    // the last N lines of a file, so the browser doesn't have to pull a
    // multi-hundred-MB log just to look at its tail.
    // The client asks for this when a second read supersedes a running
    // backfill: every reader is stopped and the client is told the slot is
    // free, so the new slice starts from a clean slate.
    socket.on('abort-read', (data) => {
      const seq = Number(data && data.seq) || 0;
      activeReads.forEach((stop) => stop());
      activeReads.clear();
      socket.emit('read-end', { seq: seq });
    });

    socket.on('read-from-start', (data) => {
      // fileIndex indexes the sources list sent in options:sources
      const fileIndex = (data && data.fileIndex) || 0;
      const force = !!(data && data.force);
      const wantsFull = !!(data && data.full);
      const maxLines = Number(data && data.lines) > 0
        ? Math.floor(Number(data.lines))
        : 0;
      const wantsMany = data && Array.isArray(data.indexes) && data.indexes.length;
      const seq = Number(data && data.seq) || 0;
      if (wantsMany) {
        const indexes = data.indexes
          .map((value) => Number(value))
          .filter((value, position, list) => Number.isInteger(value) && value >= 0 && list.indexOf(value) === position);
        if (!indexes.length) return;
        // One shared budget spread over the files keeps the browser window the
        // same size no matter how many sources are switched on.
        const perFile = Math.max(20, Math.floor((maxLines || 5000) / Math.max(1, indexes.length)));
        socket.emit('file-start-info', { size: 0, tooLarge: false, isContainer: false, seq: seq });
        startReadMany(indexes, perFile, seq);
        return;
      }

      const source = tailer.getSources()[fileIndex];
      if (!source) return;

      if (source.type !== 'file') {
        // Containers, journal and ssh: size isn't known up front, just stream it
        socket.emit('file-start-info', {
          size: 0,
          tooLarge: false,
          isContainer: true,
          seq: seq,
        });
        startRead(fileIndex, 0, seq);
        return;
      }

      let stat;
      try {
        stat = fs.statSync(source.name);
      } catch {
        return;
      }

      // The warning used to be skipped for bounded reads ("it only streams the
      // tail"), but the page always sends a line budget, so the modal could
      // never appear and a reader got no sign the file was huge. Size now
      // decides on its own: a bounded read still only streams the tail, so it
      // is cheap enough to go ahead without waiting for confirmation.
      const tooLarge = stat.size > FILE_SIZE_WARNING_BYTES;
      const warnTooLarge = tooLarge && !force && maxLines === 0;

      // Always inform client of size; tooLarge flag only set when NOT forcing
      socket.emit('file-start-info', {
        size: stat.size,
        tooLarge: warnTooLarge,
        seq: seq,
      });

      if (warnTooLarge) return; // client will show warning / download prompt

      if (wantsFull) {
        readWholeFile(source, seq);
        return;
      }

      startRead(fileIndex, maxLines, seq);
    });

    // The directory listing is built once at startup. A file written after
    // that only shows up after a refresh, so the browser asks for a fresh
    // walk on demand instead of the server watching the tree all the time.
    socket.on('refresh-log-dirs', function () {
      if (typeof onRefreshLogDirs !== 'function') return;
      let result;
      try {
        result = onRefreshLogDirs();
      } catch (err) {
        socket.emit('refresh-log-dirs-failed', { message: err.message });
        return;
      }
      currentLogDirs = result.logDirs;
      socket.emit('options:log-dirs', currentLogDirs);
      socket.emit('refresh-log-dirs-done', { files: result.files });
    });
  });

  return nsp;
}

module.exports = { attachLogSocket, errorText };
