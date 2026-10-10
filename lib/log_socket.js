'use strict';

const fs = require('fs');
const { FILE_SIZE_WARNING_BYTES } = require('./constants');

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
    const startRead = (fileIndex) => {
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
        socket.emit('read-end');
        return;
      }

      const cancel = tailer.readFromStart(
        fileIndex,
        (line) => socket.emit('line', line),
        () => {
          activeReads.delete(stop);
          release();
          socket.emit('read-end');
        }
      );
      const stop = () => {
        release();
        cancel();
      };
      activeReads.add(stop);
    };

    socket.on('disconnect', () => {
      activeReads.forEach((stop) => stop());
      activeReads.clear();
    });

    // Client asks for a source's full history
    socket.on('read-from-start', (data) => {
      // fileIndex indexes the sources list sent in options:sources
      const fileIndex = (data && data.fileIndex) || 0;
      const force = !!(data && data.force);
      const source = tailer.getSources()[fileIndex];
      if (!source) return;

      if (source.type !== 'file') {
        // Containers, journal and ssh: size isn't known up front, just stream it
        socket.emit('file-start-info', {
          size: 0,
          tooLarge: false,
          isContainer: true,
        });
        startRead(fileIndex);
        return;
      }

      let stat;
      try {
        stat = fs.statSync(source.name);
      } catch {
        return;
      }

      const tooLarge = stat.size > FILE_SIZE_WARNING_BYTES;

      // Always inform client of size; tooLarge flag only set when NOT forcing
      socket.emit('file-start-info', {
        size: stat.size,
        tooLarge: tooLarge && !force,
      });

      if (tooLarge && !force) return; // client will show warning / download prompt

      startRead(fileIndex);
    });
  });

  return nsp;
}

module.exports = { attachLogSocket, errorText };
