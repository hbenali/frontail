'use strict';

const NL = String.fromCharCode(10);

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const http = require('http');
const parseOptions = require('../lib/options_parser');
const { buildDirView, expandLogDirs } = require('../lib/log_dirs');
const { resolveSettings, start } = require('../lib/frontail');

describe('log directories', function logDirectories() {
  this.timeout(10000);

  let dir;
  const servers = [];

  const write = (name, body) => {
    const file = path.join(dir, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, body);
  };

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'frontail-dirs-'));
  });

  afterEach(async () => {
    // close() also stops `tail -f`, otherwise the file handles keep the
    // temporary directory busy on Windows.
    await Promise.all(
      servers.splice(0).map((app) => new Promise((resolve) => app.close(resolve))),
    );
    fs.rmSync(dir, { recursive: true, force: true });
  });

  // The server needs a real socket, and port 0 gives us a free one.
  const launch = async (argv) => {
    const app = start(parseOptions(['node', 'frontail', '-p', '0', '-h', '127.0.0.1', ...argv]));
    servers.push(app);
    if (!app.server.listening) {
      await new Promise((resolve) => app.server.once('listening', resolve));
    }
    return { app, base: `http://127.0.0.1:${app.server.address().port}` };
  };

  const get = (base, urlPath) =>
    new Promise((resolve, reject) => {
      http
        .get(`${base}${urlPath}`, (res) => {
          let body = '';
          res.on('data', (c) => {
            body += c;
          });
          res.on('end', () => resolve({ status: res.statusCode, body }));
        })
        .on('error', reject);
    });

  it('keeps the run alive when only a directory is given', async () => {
    write('app.log', 'first\n');
    write('sub/worker.log', 'second\n');

    const { base } = await launch(['-D', dir]);

    (await get(base, '/')).status.should.equal(200);
    const info = JSON.parse((await get(base, '/file-info')).body);
    info.map((f) => f.name).should.eql(['app.log', 'worker.log']);
  });

  it('serves files that came from a directory, not only from argv', async () => {
    write('app.log', 'download me\n');
    write('sub/worker.log', 'and me\n');

    const { app, base } = await launch([path.join(dir, 'app.log'), '--dir', dir]);
    const sources = app.tailer.getSources();
    const worker = sources.findIndex((s) => s.name.endsWith('worker.log'));
    worker.should.be.above(-1);

    const body = await get(base, `/download?file=${worker}`);
    body.status.should.equal(200);
    body.body.should.containEql('and me');
  });

  it('numbers directory files as the tailer does, after argv and containers', () => {
    write('app.log', 'a\n');
    write('legacy.log', 'b\n');
    write('sub/worker.log', 'c\n');
    const explicit = path.join(dir, 'legacy.log');

    const settings = resolveSettings(
      parseOptions(['node', 'frontail', '-C', 'web', '--dir', dir, explicit]),
    );

    // legacy.log is passed explicitly and also lives in the directory; the
    // tailer sees it once, under its argv position.
    settings.files.should.equal(
      [explicit, path.join(dir, 'app.log'), path.join(dir, 'sub', 'worker.log'), 'web'].join(' '),
    );
    // The view is built from the file list the tailer gets, so a file that was
    // passed on the command line and also lives in the directory keeps its
    // argv index and is listed in the directory entry too, in source order.
    settings.logDirs[0].files.map((f) => f.name).should.eql([
      'legacy.log',
      'app.log',
      'worker.log',
    ]);
    const names = settings.files.split(' ');
    settings.logDirs[0].files.forEach((f) => {
      names[f.fileIndex].should.equal(f.path);
    });
    // Inside the source list the argv file comes first, so the directory
    // files are at indexes 0 and 1 even though a container is listed earlier.
    settings.logDirs[0].files[0].fileIndex.should.equal(0);
  });

  // A junction is the only link a plain Windows user can create without
  // administrator rights, which makes it the realistic case to cover here.
  const makeLink = (target) => {
    const link = path.join(os.tmpdir(), `frontail-link-${process.pid}-${Date.now()}`);
    if (process.platform === 'win32') {
      execFileSync('cmd', ['/c', 'mklink', '/J', link, target], { stdio: 'ignore' });
      return link;
    }
    fs.symlinkSync(target, link, 'dir');
    return link;
  };

  it('lists the files of a linked directory', () => {
    write('app.log', 'a\n');
    write('legacy.log', 'b\n');
    write('sub/worker.log', 'c\n');
    let link;
    try {
      link = makeLink(dir);
    } catch {
      this.skip(); // no permission to create links on this machine
      return;
    }

    try {
      const { files } = expandLogDirs([link]);
      files.length.should.equal(3);
      // Files are resolved too, so the tree and the tailer agree on one path.
      files.forEach((file) => file.should.not.containEql('frontail-link-'));
      const view = buildDirView([link], files);
      view.length.should.equal(1);
      view[0].files.length.should.equal(3);
      view[0].dir.should.equal(fs.realpathSync(dir));
    } finally {
      fs.rmSync(link, { recursive: true, force: true });
    }
  });

  it('offers a file larger than the warning size instead of leaving it out', () => {
    write('app.log', 'a' + NL);
    const big = path.join(dir, 'huge.log');
    const block = Buffer.alloc(64 * 1024, 'x' + NL);
    const fd = fs.openSync(big, 'w');
    try {
      let written = 0;
      while (written < 51 * 1024 * 1024) {
        fs.writeSync(fd, block, 0, block.length, written);
        written += block.length;
      }
    } finally {
      fs.closeSync(fd);
    }

    const { files } = expandLogDirs([dir]);

    files.map((f) => path.basename(f)).should.eql(['app.log', 'huge.log']);
  });

  it('stops after the configured number of files and levels', () => {
    write('a.log', 'a' + NL);
    write('b.log', 'b' + NL);
    write('c.log', 'c' + NL);
    write('sub/deep/leaf.log', 'd' + NL);

    const narrow = expandLogDirs([dir], { maxFiles: 2 });
    narrow.files.map((f) => path.basename(f)).should.eql(['a.log', 'b.log']);

    const shallow = expandLogDirs([dir], { maxDepth: 1 });
    shallow.files.map((f) => path.basename(f)).should.be.eql([
      'a.log',
      'b.log',
      'c.log',
    ]);

    const deep = expandLogDirs([dir], { maxDepth: 3 });
    deep.files.map((f) => path.basename(f)).should.containEql('leaf.log');
  });

  it('reads the bounds from the command line', () => {
    const program = parseOptions([
      'node',
      'frontail',
      '--dir-max-files',
      '7',
      '--dir-max-depth',
      '1',
      dir,
    ]);
    program.dirMaxFiles.should.equal(7);
    program.dirMaxDepth.should.equal(1);

    const defaults = parseOptions(['node', 'frontail', dir]);
    defaults.dirMaxFiles.should.equal(200);
    defaults.dirMaxDepth.should.equal(3);
  });
});
