'use strict';

const fs = require('fs');
const { FILE_SIZE_WARNING_BYTES } = require('./constants');

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
}) {
  const nsp = io.of(`/${namespace}`);
  if (requireSession) {
    nsp.use(requireSession);
  }

  nsp.on('connection', (socket) => {
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
    socket.emit('options:log-dirs', logDirs || []);

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
      const chunk = [];
      const flushChunk = () => {
        if (!chunk.length) return;
        socket.emit('bulk-lines', { lines: chunk.slice(), s: null, seq: seq });
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

    // A full read is delivered as one chunk: streaming a big file line by
    // line keeps the browser busy for minutes with nothing to paint in
    // between. The snapshot lands as a single event, live lines keep coming
    // from the normal tail.
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

      // A bounded read never needs the "this file is huge, load it anyway?"
      // warning: it only ever streams the tail.
      const tooLarge = maxLines > 0 ? false : stat.size > FILE_SIZE_WARNING_BYTES;

      // Always inform client of size; tooLarge flag only set when NOT forcing
      socket.emit('file-start-info', {
        size: stat.size,
        tooLarge: tooLarge && !force,
        seq: seq,
      });

      if (tooLarge && !force) return; // client will show warning / download prompt

      if (wantsFull) {
        readWholeFile(source, seq);
        return;
      }

      startRead(fileIndex, maxLines, seq);
    });
  });

  return nsp;
}

module.exports = { attachLogSocket, errorText };
