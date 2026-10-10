'use strict';

// The browser colorizer runs in Node too: no DOM, so no jsdom needed.
const formats = require('../web/assets/formats');

describe('formats (browser colorizer module)', () => {
  describe('detectLevel', () => {
    it('detects levels from words', () => {
      formats.detectLevel('something FATAL happened').should.equal('error');
      formats.detectLevel('a warning here').should.equal('warn');
      formats.detectLevel('INFO started').should.equal('info');
      formats.detectLevel('debug noise').should.equal('debug');
      formats.detectLevel('nothing special').should.equal('');
    });

    it('reads the klog severity letter', () => {
      formats.detectLevel('E0101 12:00:00.123456 1 main.go:1] x').should.equal('error');
      formats.detectLevel('W0101 12:00:00.123456 1 main.go:1] x').should.equal('warn');
      formats.detectLevel('I0101 12:00:00.123456 1 main.go:1] x').should.equal('info');
    });
  });

  it('detects ANSI escape codes', () => {
    formats.hasAnsiCodes('\u001b[31mred\u001b[0m').should.be.true;
    formats.hasAnsiCodes('plain').should.be.false;
  });

  describe('tryColorizeJson', () => {
    it('renders a JSON object as colorized key=value pairs', () => {
      const html = formats.tryColorizeJson('{"level":"error","msg":"boom <b>"}');

      html.should.containEql('log-fc-jkey">level');
      html.should.containEql('log-fc-level-error">error');
      html.should.containEql('boom &lt;b&gt;');
    });

    it('returns null for non-JSON and non-objects', () => {
      (formats.tryColorizeJson('hello') === null).should.be.true;
      (formats.tryColorizeJson('[1,2]') === null).should.be.true;
      (formats.tryColorizeJson('{not json}') === null).should.be.true;
    });
  });

  describe('applyFormatColors', () => {
    it('matches rules against escaped quotes (&quot;)', () => {
      const html = formats.applyFormatColors(
        '1.2.3.4 - - [01/Jan/2024:12:00:00 +0000] &quot;GET /a HTTP/1.1&quot; 404 12'
      );

      html.should.containEql('log-fc-method">GET');
      html.should.containEql('log-fc-status-4xx">404');
    });

    it('falls back to generic token coloring', () => {
      const html = formats.applyFormatColors('2024-01-01 12:00:00 something ERROR from 10.0.0.1');

      html.should.containEql('log-fc-time');
      html.should.containEql('log-fc-level-error">ERROR');
      html.should.containEql('log-fc-ip">10.0.0.1');
    });

    it('does not treat a plain sentence as logfmt', () => {
      formats
        .applyFormatColors('this is a = b sentence')
        .should.not.containEql('log-fc-jkey');
    });

    it('stays fast on pathological logfmt-looking lines', () => {
      const evil = `A= A=${'&quot;&quot; A='.repeat(5000)}`;
      const start = Date.now();

      formats.applyFormatColors(evil);

      (Date.now() - start).should.be.below(500);
    });
  });

  describe('user rules', () => {
    afterEach(() => formats.setUserRules([]));

    it('apply before the built-in rules, with class/level/colour specs', () => {
      formats.setUserRules([
        {
          regex: '^trace=(\\w+) lvl=(\\w+)',
          template: '{1:#c084fc} {2:level}',
        },
      ]);

      const html = formats.applyFormatColors('trace=abc lvl=error rest');

      html.should.containEql('<span style="color:#c084fc">abc</span>');
      html.should.containEql('log-fc-level-error">error');
    });

    it('ignore invalid rules instead of throwing', () => {
      formats.setUserRules([{ regex: '(', template: 'x' }, null, { regex: 'a' }]);

      formats.applyFormatColors('plain line').should.be.a.String;
    });
  });
});
