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
  // What start() has to spawn, one entry per source. Spawning stays a
  // separate, retractable step so an idle frontail runs no processes at all.
  this._plans = [];
  this._following = false;

  const makeOnLine = (source) => (line) => {
    // Killing a child flushes a trailing empty line from byline; drop
    // anything that arrives once we are closed.
    if (this._closed) return;
    const tagged = { t: line.toString(), s: source };
    this._buffer.push(tagged);
    this.emit('line', tagged);
  };

  // dropTrailingBlank: for streams that can end (a reconnecting ssh/journal
  // command). byline flushes a final empty line when the stream ends, which
  // would show up as a bogus blank line on every reconnect; blank lines are
  // held back and only emitted once a later line proves they weren't the
  // tail end of the stream.
  this._setupStream = (stream, source, dropTrailingBlank) => {
    const onLine = makeOnLine(source);
    const lines = byline(stream, { keepEmptyLines: true });
    if (!dropTrailingBlank) {
      lines.on('data', onLine);
      return;
    }
    let blanks = 0;
    lines.on('data', (line) => {
      if (line.length === 0) {
        blanks += 1;
        return;
      }
      for (; blanks > 0; blanks -= 1) onLine('');
      onLine(line);
    });
  };

  this._trackProcess = (cp) => {
    this._childProcesses.push(cp);
  };

  // Kept so close() can remove it: one listener per instance would
  // otherwise accumulate on `process`.
  this._onProcessExit = this._killAll.bind(this);
  process.on('exit', this._onProcessExit);

  this._timers = [];

  // Only the source list is built here. It is what the browser enumerates
  // and what the download endpoints resolve, so it must not depend on
  // whether anything is being followed right now: spawning is deferred to
  // start(), which an idle frontail never reaches.
  // Container log streaming (can run alongside files)
  if (this._options.container && this._options.container.length > 0) {
    const engine = this._options.containerEngine || 'docker';
    this._options.container.forEach((container) => {
      this._sources.push({ name: container, type: 'container' });
      this._readers.push({ command: engine, args: ['logs', container] });
      this._plans.push({ type: 'container', source: container, engine: engine });
    });
  }

  // File log streaming
  if (this._path[0] === '-') {
    this._sources.push({ name: 'stdin', type: 'file' });
    this._readers.push(null);
    this._plans.push({ type: 'stdin', source: 'stdin' });
  } else if (this._path.length > 0) {
    this._path.forEach((filePath) => {
      this._sources.push({ name: filePath, type: 'file' });
      this._readers.push(null); // files are read directly, see readFromStart
      this._plans.push({ type: 'file', source: filePath });
    });
  }

  // Command-backed sources (systemd journal, remote files over ssh)
  commandSources(this._options, this._options.buffer).forEach((src) => {
    this._sources.push({ name: src.name, type: src.type });
    this._readers.push(src.read);
    this._plans.push({ type: 'command', source: src.name, src: src });
  });

  // Nothing is spawned here: an idle frontail must run no child processes.
  // start() is driven by whoever actually watches (the socket layer), or
  // explicitly by a caller that passes { follow: true }.
  if (this._options.follow === true) {
    this.start();
  }
}
util.inherits(Tail, events.EventEmitter);

/**
 * Starts following every source. A no-op when already following or closed,
 * so a second browser does not double the number of child processes.
 */
Tail.prototype.start = function start() {
  if (this._closed || this._following) return this;
  this._following = true;
  this._plans.forEach((plan) => {
    if (plan.type === 'container') {
      this._followContainer(plan);
    } else if (plan.type === 'file') {
      this._followFile(plan);
    } else if (plan.type === 'stdin') {
      this._setupStream(process.stdin, 'stdin');
    } else if (plan.type === 'command') {
      this._runCommandSource(
        plan.src,
        plan.src.follow,
        { attempt: 0 },
        this._setupStream,
        this._trackProcess
      );
    }
  });
  return this;
};

/**
 * Stops following and kills every child process, keeping the source list
 * and the buffered lines: the next start() resumes at the current end of
 * each file instead of replaying it.
 */
Tail.prototype.stop = function stop() {
  const wasFollowing = this._following;
  this._following = false;
  (this._timers || []).forEach((t) => clearTimeout(t));
  this._timers = [];
  if (wasFollowing) this._killAll();
  return this;
};

Tail.prototype.isFollowing = function isFollowing() {
  return this._following;
};

Tail.prototype._followContainer = function followContainer(plan) {
  const source = plan.source;
  const engine = plan.engine;
  const cp = childProcess.spawn(engine, [
    'logs',
    '-f',
    '--tail',
    this._options.buffer,
    source,
  ]);
  cp.on('error', (err) => {
    this._reportError({
      source: source,
      container: source,
      message: 'Failed to spawn ' + engine + ': ' + err.message,
    });
  });
  cp.stderr.on('data', (data) => {
    const msg = data.toString().trim();
    if (msg) {
      this._reportError({ source: source, container: source, message: msg });
    }
    console.error(data.toString());
  });
  this._setupStream(cp.stdout, source);
  this._trackProcess(cp);
};

Tail.prototype._followFile = function followFile(plan) {
  const filePath = plan.source;
  const hasTailCommand = commandExistsSync('tail');
  let followOpt = '-F';
  if (process.platform === 'openbsd') {
    followOpt = '-f';
  }

  if (!hasTailCommand) {
    /* This is used if the os does not support the `tail`command. */
    const stream = tailStream.createReadStream(filePath, {
      encoding: 'utf8',
      start: this._options.buffer,
      tail: true,
    });
    this._setupStream(stream, filePath);
    return;
  }

  const cp = childProcess.spawn('tail', [
    '-n',
    this._options.buffer,
    followOpt,
    filePath,
  ]);
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
      this._reportError({ source: filePath, message: message });
    }
  });
  this._setupStream(cp.stdout, filePath);
  this._trackProcess(cp);
};


// Files up to this size are read in process instead of by a `tail` child.
const INLINE_READ_MAX_BYTES = 8 * 1024 * 1024;

const fileSizeBelow = (filePath, maxBytes) => {
  try {
    return fs.statSync(filePath).size <= maxBytes;
  } catch (unreadable) {
    void unreadable;
    return false;
  }
};

const RECONNECT_BASE_MS = 2000;
const RECONNECT_MAX_MS = 60000;
// A connection that lasted this long counts as healthy: back to a fast retry.
const RECONNECT_STABLE_MS = 30000;

/**
 * Runs a command-backed source and restarts it with exponential backoff
 * when it exits (dropped ssh session, journalctl restart, ...). The restart
 * uses src.resume so lines already shown aren't replayed.
 */
Tail.prototype._runCommandSource = function runCommandSource(
  src,
  spec,
  state,
  setupStream,
  trackProcess
) {
  const base = this._options.reconnectBaseMs || RECONNECT_BASE_MS;
  const max = this._options.reconnectMaxMs || RECONNECT_MAX_MS;
  const stable = this._options.reconnectStableMs || RECONNECT_STABLE_MS;
  const startedAt = Date.now();

  const cp = childProcess.spawn(spec.command, spec.args);
  let failedToStart = false;
  cp.on('error', (err) => {
    // e.g. ENOENT: the program isn't installed, retrying cannot help
    failedToStart = true;
    this._reportError({
      source: src.name,
      message: `Failed to run ${spec.command}: ${err.message}`,
    });
  });
  byline(cp.stderr).on('data', (raw) => {
    const message = raw.toString().trim();
    if (message) this._reportError({ source: src.name, message });
  });
  cp.on('close', (code) => {
    this._childProcesses = this._childProcesses.filter((c) => c !== cp);
    if (this._closed || failedToStart) return;
    // A follower killed by stop() is not a broken connection: do not
    // reconnect on behalf of a browser that is no longer there.
    if (!this._following) return;

    state.attempt = Date.now() - startedAt > stable ? 1 : state.attempt + 1;
    const delay = Math.min(max, base * 2 ** (state.attempt - 1));
    this._reportError({
      source: src.name,
      message: `${spec.command} exited${code ? ` with code ${code}` : ''}; reconnecting in ${Math.round(delay / 1000) || '<1'}s`,
    });
    const timer = setTimeout(() => {
      this._timers = this._timers.filter((t) => t !== timer);
      if (!this._closed && this._following) {
        this._runCommandSource(src, src.resume, state, setupStream, trackProcess);
      }
    }, delay);
    timer.unref();
    this._timers.push(timer);
  });
  setupStream(cp.stdout, src.name, true);
  trackProcess(cp);
};

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
  this._following = false;
  (this._timers || []).forEach((t) => clearTimeout(t));
  this._timers = [];
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
 * Streams a source to onLine, then calls onEnd. `sourceIndex` indexes
 * getSources(). Returns a cancel() function that stops the read and
 * releases the child process / file handle (e.g. when the requesting client
 * disconnects); onEnd is not called after a cancel.
 *
 * `maxLines` (files only) streams just the last N lines via `tail -n N`
 * instead of the whole file, so the UI can page back through huge logs
 * without reading hundreds of megabytes. Without it, or when no `tail`
 * binary is available, the whole file is streamed as before.
 */
Tail.prototype.readFromStart = function readFromStart(sourceIndex, onLine, onEnd, maxLines) {
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

  // A child process (container/journal/ssh reader, or the `tail -n` read
  // below) streams through byline; the returned cancel kills it.
  const streamProcess = (cp, lineOptions = {}) => {
    this._childProcesses.push(cp);
    cp.on('error', end);
    cp.on('close', () => {
      this._childProcesses = this._childProcesses.filter((c) => c !== cp);
    });
    const lineStream = byline(cp.stdout, lineOptions);
    lineStream.on('data', (line) => emitLine({ t: line.toString(), s: source.name }));
    lineStream.on('end', end);
    return () => {
      cancelled = true;
      cp.kill();
    };
  };

  if (reader) {
    return streamProcess(childProcess.spawn(reader.command, reader.args), { keepEmptyLines: true });
  }

  const limit = Number(maxLines) > 0 ? Math.floor(Number(maxLines)) : 0;
  // Spawning `tail` for every file of a directory tree costs more than the
  // read itself: 200 sources took ten seconds. A file small enough to stream
  // in this process is read here and only its last `limit` rows are kept, so
  // the socket sees the same rows without 200 child processes.
  if (limit > 0 && fileSizeBelow(source.name, INLINE_READ_MAX_BYTES)) {
    const kept = [];
    const stream = fs.createReadStream(source.name, { encoding: 'utf8' });
    const localRl = readline.createInterface({ input: stream, crlfDelay: Infinity });
    localRl.on('line', (line) => {
      if (cancelled) return;
      kept.push(line);
      if (kept.length > limit) kept.shift();
    });
    localRl.on('close', () => {
      if (cancelled || ended) return;
      for (const line of kept) onLine({ t: line, s: source.name });
      end();
    });
    stream.on('error', end);
    localRl.on('error', end);
    return () => {
      cancelled = true;
      localRl.close();
      stream.destroy();
    };
  }

  if (limit > 0 && commandExistsSync('tail')) {
    // `keepEmptyLines: false` drops the empty line a trailing newline would
    // otherwise add at the very end of the tail view.
    return streamProcess(childProcess.spawn('tail', ['-n', String(limit), source.name]), {
      keepEmptyLines: false,
    });
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
