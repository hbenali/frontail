'use strict';

const { commandSources, sshSource, shellQuote } = require('../lib/sources');

describe('command sources', () => {
  describe('journal', () => {
    it('is absent unless requested', () => {
      commandSources({}, 10).should.eql([]);
    });

    it('follows the whole journal with --journal', () => {
      const [source] = commandSources({ journal: true }, 25);

      source.name.should.equal('journal');
      source.type.should.equal('journal');
      source.follow.command.should.equal('journalctl');
      source.follow.args.should.eql(['--no-pager', '-f', '-n', '25']);
      source.read.args.should.eql(['--no-pager']);
    });

    it('filters by unit and names the source after them', () => {
      const [source] = commandSources(
        { journalUnit: ['sshd.service', 'nginx'] },
        10
      );

      source.name.should.equal('journal:sshd.service,nginx');
      source.follow.args.should.containDeep(['-u', 'sshd.service', '-u', 'nginx']);
      source.read.args.should.eql([
        '--no-pager',
        '-u',
        'sshd.service',
        '-u',
        'nginx',
      ]);
    });

    it('rejects units that could be read as options or contain junk', () => {
      ['--output=json', '-f', 'a b', 'a;b', '$(x)'].forEach((unit) => {
        (() => commandSources({ journalUnit: [unit] }, 10)).should.throw(
          /Invalid --journal-unit/
        );
      });
    });
  });

  describe('ssh', () => {
    it('builds follow and read commands without a shell', () => {
      const source = sshSource('root@web1:/var/log/syslog', 10);

      source.name.should.equal('root@web1:/var/log/syslog');
      source.type.should.equal('ssh');
      source.follow.command.should.equal('ssh');
      source.follow.args.should.eql([
        '-o',
        'BatchMode=yes',
        '-o',
        'ConnectTimeout=10',
        '-o',
        'ServerAliveInterval=15',
        '-o',
        'ServerAliveCountMax=3',
        '--',
        'root@web1',
        "tail -n 10 -F '/var/log/syslog'",
      ]);
      source.read.args.slice(-2).should.eql(['root@web1', "cat '/var/log/syslog'"]);
    });

    it('resumes with -n 0 so a reconnect does not replay lines', () => {
      sshSource('web1:/var/log/syslog', 10)
        .resume.args.slice(-1)[0]
        .should.equal("tail -n 0 -F '/var/log/syslog'");
      commandSources({ journal: true }, 10)[0].resume.args.should.eql([
        '--no-pager',
        '-f',
        '-n',
        '0',
      ]);
    });

    it('accepts hosts, IPv4 and bracketed IPv6 with or without a user', () => {
      ['web1:/a', 'u@web1.example.com:/a', 'u@10.0.0.5:/a', 'u@[fe80::1]:/a'].forEach(
        (spec) => {
          sshSource(spec, 1).type.should.equal('ssh');
        }
      );
    });

    it('rejects a host that could be read as an ssh option', () => {
      ['-oProxyCommand=evil:/a', '-J x:/a', 'u@-bad:/a'].forEach((spec) => {
        (() => sshSource(spec, 1)).should.throw(/Invalid --ssh/);
      });
    });

    it('rejects relative paths and malformed specs', () => {
      ['web1:relative', 'web1', ':/a', 'a b:/c'].forEach((spec) => {
        (() => sshSource(spec, 1)).should.throw(/Invalid --ssh/);
      });
    });

    it('single-quotes the remote path so it cannot inject remote commands', () => {
      const source = sshSource("web1:/var/log/a'; rm -rf /; echo '.log", 5);

      source.follow.args[10].should.equal(
        "tail -n 5 -F '/var/log/a'\\''; rm -rf /; echo '\\''.log'"
      );
      shellQuote("it's").should.equal("'it'\\''s'");
    });

    it('rejects control characters in the path', () => {
      (() => sshSource('web1:/a\nb', 1)).should.throw(/Invalid --ssh/);
    });
  });
});
