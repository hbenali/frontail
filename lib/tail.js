/* eslint no-underscore-dangle: off */

'use strict';

const events = require('events');
const childProcess = require('child_process');
const fs = require('fs');
const readline = require('readline');
const tailStream = require('fs-tail-stream');
const util = require('util');
const CBuffer = require('CBuffer');
const byline = require('byline');
const commandExistsSync = require('./command_exists');
const { commandSources } = require('./sources');

// GNU/BSD tail prints e.g. "tail: cannot open '/x' for reading: Permission
// denied". Returns the human part, or null for informational lines
// ("has appeared", "file truncated", ...).
const FILE_ERROR_RX = /cannot open|permission denied|no such file|has become inaccessible|error reading|is a directory/i;
function fileErrorMessage(line) {
  const text = line.trim();
  if (!text || !FILE_ERROR_RX.test(text)) return null;
  return text.replace(/^tail:\s*/, '');
}

const MAX_ERRORS = 50;

function Tail(path, opts) {
  events.EventEmitter.call(this);

  this._path = Array.isArray(path) ? path : [path];
  this._options = opts || {
    buffer: 0,
  };
  this._buffer = new CBuffer(this._options.buffer);
  this._errors = [];
  this._sources = [];
  // How to read a source from the beginning, parallel to _sources.
  this._readers = [];
  this._childProcesses = [];

  const makeOnLine = (source) => (line) => {
    // Killing a child flushes a trailing empty line from byline; drop
    // anything that arrives once we are closed.
    if (this._closed) return;
    const tagged = { t: line.toString(), s: source };
    this._buffer.push(tagged);
    this.emit('line', tagged);
  };

  const setupStream = (stream, source) => {
    byline(stream, { keepEmptyLines: true }).on('data', makeOnLine(source));
  };

  const trackProcess = (cp) => {
    this._childProcesses.push(cp);
  };

  // Kept so close() can remove it: one listener per instance would
  // otherwise accumulate on `process`.
  this._onProcessExit = this._killAll.bind(this);
  process.on('exit', this._onProcessExit);

  // Container log streaming (can run alongside files)
  if (this._options.container && this._options.container.length > 0) {
    const engine = this._options.containerEngine || 'docker';
    this._options.container.forEach((container) => {
      this._sources.push({ name: container, type: 'container' });
      this._readers.push({ command: engine, args: ['logs', container] });
      const cp = childProcess.spawn(engine, [
        'logs',
        '-f',
        '--tail',
        this._options.buffer,
        container,
      ]);
      cp.on('error', (err) => {
        this._reportError({
          source: container,
          container,
          message: `Failed to spawn ${engine}: ${err.message}`,
        });
      });
      cp.stderr.on('data', (data) => {
        const msg = data.toString().trim();
        if (msg) {
          this._reportError({ source: container, container, message: msg });
        }
        console.error(data.toString());
      });
      setupStream(cp.stdout, container);
      trackProcess(cp);
    });
  }

  // File log streaming
  if (this._path[0] === '-') {
    this._sources.push({ name: 'stdin', type: 'file' });
    this._readers.push(null);
    setupStream(process.stdin, 'stdin');
  } else if (this._path.length > 0) {
    const hasTailCommand = commandExistsSync('tail');
    let followOpt = '-F';
    if (process.platform === 'openbsd') {
      followOpt = '-f';
    }

    this._path.forEach((filePath) => {
      this._sources.push({ name: filePath, type: 'file' });
      this._readers.push(null); // files are read directly, see readFromStart
      if (hasTailCommand) {
        const cp = childProcess.spawn(
          'tail',
          ['-n', this._options.buffer, followOpt, filePath]
        );
        // Line-buffered: stderr arrives in arbitrary chunks, and a message
        // split mid-line would be reported as two bogus errors.
        byline(cp.stderr).on('data', (raw) => {
          // Tail keeps running after these. A truncated file is normal (it
          // can happen over network mounts); everything else is shown in
          // the console and, for real failures, in the UI so an unreadable
          // or missing file doesn't just look like "no logs".
          const text = raw.toString();
          if (text.indexOf('file truncated') === -1) {
            console.error(text);
          }
          const message = fileErrorMessage(text);
          if (message) {
            this._reportError({ source: filePath, message });
          }
        });
        setupStream(cp.stdout, filePath);
        trackProcess(cp);
      } else {
        /* This is used if the os does not support the `tail`command. */
        const stream = tailStream.createReadStream(filePath, {
          encoding: 'utf8',
          start: this._options.buffer,
          tail: true,
        });
        setupStream(stream, filePath);
      }
    });
  }

  // Command-backed sources (systemd journal, remote files over ssh)
  commandSources(this._options, this._options.buffer).forEach((src) => {
    this._sources.push({ name: src.name, type: src.type });
    this._readers.push(src.read);

    const cp = childProcess.spawn(src.follow.command, src.follow.args);
    cp.on('error', (err) => {
      this._reportError({
        source: src.name,
        message: `Failed to run ${src.follow.command}: ${err.message}`,
      });
    });
    byline(cp.stderr).on('data', (raw) => {
      const message = raw.toString().trim();
      if (message) this._reportError({ source: src.name, message });
    });
    cp.on('close', (code) => {
      // A dropped ssh session or a crashed journalctl stops the stream
      // silently otherwise.
      if (code && !this._closed) {
        this._reportError({
          source: src.name,
          message: `${src.follow.command} exited with code ${code}; no more lines will arrive`,
        });
      }
    });
    setupStream(cp.stdout, src.name);
    trackProcess(cp);
  });
}
util.inherits(Tail, events.EventEmitter);

Tail.prototype._reportError = function reportError(err) {
  if (this._closed) return;
  // Same condition repeating (e.g. around log rotation) isn't new news.
  const last = this._errors[this._errors.length - 1];
  if (last && last.source === err.source && last.message === err.message) return;
  this._errors.push(err);
  if (this._errors.length > MAX_ERRORS) this._errors.shift();
  // An EventEmitter throws on 'error' without a listener.
  if (this.listenerCount('error') > 0) this.emit('error', err);
};

Tail.prototype.getBuffer = function getBuffer() {
  return this._buffer.toArray();
};

Tail.prototype.getErrors = function getErrors() {
  return this._errors.slice();
};

Tail.prototype.getSources = function getSources() {
  return this._sources.slice();
};

Tail.prototype._killAll = function _killAll() {
  this._childProcesses.forEach((cp) => cp.kill());
  this._childProcesses = [];
};

Tail.prototype.close = function close() {
  this._closed = true;
  process.removeListener('exit', this._onProcessExit);
  this._killAll();
};

Tail.prototype.getReadCommands = function getReadCommands() {
  // Command-backed sources (containers, journal, ssh) with a name, for
  // endpoints that stream a full log as a download.
  return this._sources
    .map((source, index) => ({ source, reader: this._readers[index] }))
    .filter(({ reader }) => reader)
    .map(({ source, reader }) => ({
      name: source.name,
      type: source.type,
      command: reader.command,
      args: reader.args,
    }));
};

/**
 * Streams a whole source to onLine, then calls onEnd. `sourceIndex` indexes
 * getSources(). Returns a cancel() function that stops the read and
 * releases the child process / file handle (e.g. when the requesting client
 * disconnects); onEnd is not called after a cancel.
 */
Tail.prototype.readFromStart = function readFromStart(sourceIndex, onLine, onEnd) {
  const source = this._sources[sourceIndex];
  if (!source) return () => {};
  const reader = this._readers[sourceIndex];

  let cancelled = false;
  let ended = false;
  const end = () => {
    // An unreadable file reports through both the stream and the readline
    // interface; only call back once.
    if (cancelled || ended) return;
    ended = true;
    if (onEnd) onEnd();
  };
  const emitLine = (line) => {
    if (!cancelled) onLine(line);
  };

  if (reader) {
    const cp = childProcess.spawn(reader.command, reader.args);
    this._childProcesses.push(cp);
    cp.on('error', end);
    cp.on('close', () => {
      this._childProcesses = this._childProcesses.filter((c) => c !== cp);
    });
    const lineStream = byline(cp.stdout, { keepEmptyLines: true });
    lineStream.on('data', (line) => emitLine({ t: line.toString(), s: source.name }));
    lineStream.on('end', end);
    return () => {
      cancelled = true;
      cp.kill();
    };
  }

  const input = fs.createReadStream(source.name, { encoding: 'utf8' });
  const rl = readline.createInterface({ input, crlfDelay: Infinity });
  rl.on('line', (line) => emitLine({ t: line, s: source.name }));
  rl.on('close', end);
  // A missing/unreadable file errors on the stream, not on the interface.
  input.on('error', end);
  rl.on('error', end);
  return () => {
    cancelled = true;
    rl.close();
    input.destroy();
  };
};

module.exports = (path, options) => new Tail(path, options);
