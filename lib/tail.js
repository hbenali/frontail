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

function Tail(path, opts) {
  events.EventEmitter.call(this);

  this._path = Array.isArray(path) ? path : [path];
  this._options = opts || {
    buffer: 0,
  };
  this._buffer = new CBuffer(this._options.buffer);
  this._errors = [];
  this._sources = [];
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
      const cp = childProcess.spawn(engine, [
        'logs',
        '-f',
        '--tail',
        this._options.buffer,
        container,
      ]);
      cp.on('error', (err) => {
        const errObj = { container, message: `Failed to spawn ${  engine  }: ${  err.message}` };
        this.emit('error', errObj);
        this._errors.push(errObj);
      });
      cp.stderr.on('data', (data) => {
        const msg = data.toString().trim();
        if (msg) {
          const errObj = { container, message: msg };
          this.emit('error', errObj);
          this._errors.push(errObj);
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
    setupStream(process.stdin, 'stdin');
  } else if (this._path.length > 0) {
    const hasTailCommand = commandExistsSync('tail');
    let followOpt = '-F';
    if (process.platform === 'openbsd') {
      followOpt = '-f';
    }

    this._path.forEach((filePath) => {
      this._sources.push({ name: filePath, type: 'file' });
      if (hasTailCommand) {
        const cp = childProcess.spawn(
          'tail',
          ['-n', this._options.buffer, followOpt, filePath]
        );
        cp.stderr.on('data', (data) => {
          // If there is any important error then display it in the console. Tail will keep running.
          // File can be truncated over network.
          if (data.toString().indexOf('file truncated') === -1) {
            console.error(data.toString());
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
}
util.inherits(Tail, events.EventEmitter);

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

/**
 * Streams a whole file or container log to onLine, then calls onEnd.
 * Returns a cancel() function that stops the read and releases the child
 * process / file handle (e.g. when the requesting client disconnects);
 * onEnd is not called after a cancel.
 */
Tail.prototype.readFromStart = function readFromStart(fileIndex, onLine, onEnd) {
  const isContainer = this._options.container && this._options.container.length > 0;
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

  if (isContainer) {
    const container = this._options.container[fileIndex];
    if (!container) return () => {};
    const engine = this._options.containerEngine || 'docker';
    const cp = childProcess.spawn(engine, ['logs', container]);
    this._childProcesses.push(cp);
    cp.on('error', end);
    cp.on('close', () => {
      this._childProcesses = this._childProcesses.filter((c) => c !== cp);
    });
    const lineStream = byline(cp.stdout, { keepEmptyLines: true });
    lineStream.on('data', (line) => emitLine({ t: line.toString(), s: container }));
    lineStream.on('end', end);
    return () => {
      cancelled = true;
      cp.kill();
    };
  }

  const filePath = this._path[fileIndex];
  if (!filePath) return () => {};
  const input = fs.createReadStream(filePath, { encoding: 'utf8' });
  const rl = readline.createInterface({ input, crlfDelay: Infinity });
  rl.on('line', (line) => emitLine({ t: line, s: filePath }));
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
