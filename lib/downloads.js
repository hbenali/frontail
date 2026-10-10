'use strict';

const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');
const byline = require('byline');
const { FILE_SIZE_WARNING_BYTES } = require('./constants');

// eslint-disable-next-line no-control-regex
const ANSI_REGEX = /\x1b\[[0-9;]*[a-zA-Z]/g;

/** Pipes a readable stream to res, stripping ANSI escape sequences line by line. */
function pipeSanitized(readStream, res) {
  const lines = byline(readStream, { keepEmptyLines: true });
  lines.on('data', (line) => {
    res.write(`${line.toString('utf-8').replace(ANSI_REGEX, '')}\n`);
  });
  lines.on('end', () => res.end());
  const fail = () => {
    if (!res.headersSent) {
      res.writeHead(500);
    }
    res.end();
  };
  lines.on('error', fail);
  readStream.on('error', fail);
}

function sanitizedFilename(filename) {
  return /\.[^/.]+$/.test(filename)
    ? filename.replace(/(\.[^/.]+)$/, '.sanitized$1')
    : `${filename}.sanitized`;
}

function attachmentHeaders(filename) {
  return {
    'Content-Type': 'application/octet-stream',
    'Content-Disposition': `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    'Cache-Control': 'no-store',
  };
}

/**
 * Streams a child process's stdout as a download. The process is killed if
 * the client goes away.
 */
function streamCommand(res, command, args, filename, sanitize) {
  const cp = childProcess.spawn(command, args);
  res.writeHead(200, attachmentHeaders(filename));
  cp.stderr.on('data', () => {}); // swallow stderr
  cp.on('error', () => {
    if (!res.headersSent) {
      res.writeHead(500);
    }
    res.end();
  });
  res.on('close', () => cp.kill());
  if (sanitize) {
    pipeSanitized(cp.stdout, res);
  } else {
    cp.stdout.pipe(res);
  }
}

function notFound(res, message) {
  res.writeHead(404);
  res.end(message);
}

/**
 * GET <urlPath>/file-info: JSON with sizes and the too-large flag per file.
 * @param {string[]} filePaths
 */
function fileInfoHandler(filePaths) {
  return (req, res) => {
    const info = filePaths.map((fp, idx) => {
      let size = 0;
      let exists = false;
      try {
        size = fs.statSync(fp).size;
        exists = true;
      } catch {
        /* ignore */
      }
      return {
        index: idx,
        name: path.basename(fp),
        path: fp,
        size,
        exists,
        tooLarge: size > FILE_SIZE_WARNING_BYTES,
      };
    });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(info));
  };
}

/**
 * GET <urlPath>/download?file=<index> | ?container=<index> | ?command=<index>
 * (+ &sanitize=1 to strip ANSI codes). Streams a file, a container log or a
 * journal/ssh log as an attachment.
 *
 * @param {object} sources
 * @param {string[]} sources.filePaths
 * @param {string[]} [sources.containers]
 * @param {string} [sources.engine]
 * @param {() => { name: string, command: string, args: string[] }[]} [sources.commands]
 *   resolved per request (the tailer is created after the HTTP app)
 */
function downloadHandler({ filePaths, containers, engine, commands }) {
  const containerList = containers || [];
  const containerEngine = engine || 'docker';
  const commandList = () => (commands && commands()) || [];

  return (req, res) => {
    const rawUrl = req.originalUrl || req.url;
    const qIndex = rawUrl.indexOf('?');
    const params = new URLSearchParams(qIndex !== -1 ? rawUrl.slice(qIndex + 1) : '');
    const sanitize = params.get('sanitize') === '1';
    const index = (name) => parseInt(params.get(name) || '0', 10);

    if (params.has('container')) {
      const container = containerList[index('container')];
      if (!container) return notFound(res, 'Container not found');
      const filename = sanitize ? `${container}.sanitized.log` : `${container}.log`;
      return streamCommand(res, containerEngine, ['logs', container], filename, sanitize);
    }

    if (params.has('command')) {
      const cmd = commandList()[index('command')];
      if (!cmd) return notFound(res, 'Source not found');
      const base = cmd.name.replace(/[^\w.@-]+/g, '_');
      const filename = sanitize ? `${base}.sanitized.log` : `${base}.log`;
      return streamCommand(res, cmd.command, cmd.args, filename, sanitize);
    }

    const fp = filePaths[index('file')];
    if (!fp) return notFound(res, 'Not found');
    let stat;
    try {
      stat = fs.statSync(fp);
    } catch {
      return notFound(res, 'File not found');
    }
    const filename = sanitize ? sanitizedFilename(path.basename(fp)) : path.basename(fp);
    const headers = attachmentHeaders(filename);
    // Sanitizing rewrites bytes (stripped ANSI codes), so the original size no longer applies
    if (!sanitize) {
      headers['Content-Length'] = stat.size;
    }
    res.writeHead(200, headers);
    const stream = fs.createReadStream(fp);
    if (sanitize) {
      pipeSanitized(stream, res);
    } else {
      stream.pipe(res);
    }
    return undefined;
  };
}

module.exports = { fileInfoHandler, downloadHandler, pipeSanitized, sanitizedFilename };
