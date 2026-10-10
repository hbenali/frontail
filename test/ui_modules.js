'use strict';

// Browser UI helper modules. They are DOM-free, so they run in plain Node.
const util = require('../web/assets/util');
const settings = require('../web/assets/settings');
const filters = require('../web/assets/filters');
const highlight = require('../web/assets/highlight');

describe('ui util', () => {
  it('escapes html and regex metacharacters', () => {
    util.escapeHtml('<a href="x">&</a>').should.equal('&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;');
    util.escapeRegExp('a.b*c(d)[e]').should.equal('a\\.b\\*c\\(d\\)\\[e\\]');
    new RegExp(util.escapeRegExp('1+1=2?')).test('1+1=2?').should.be.true;
  });

  it('takes the last path segment', () => {
    util.basename('/var/log/syslog').should.equal('syslog');
    util.basename('journal:sshd').should.equal('journal:sshd');
    util.basename('/dir/').should.equal('/dir/');
    (util.basename('') === '').should.be.true;
  });

  it('formats byte sizes', () => {
    util.formatBytes(512).should.equal('512 B');
    util.formatBytes(1536).should.equal('1.5 KB');
    util.formatBytes(5 * 1048576).should.equal('5.0 MB');
    util.formatBytes(3 * 1073741824).should.equal('3.00 GB');
  });

  it('debounce runs once after the last call', (done) => {
    let calls = 0;
    const fn = util.debounce(() => {
      calls += 1;
    }, 20);

    fn();
    fn();
    fn();

    setTimeout(() => {
      calls.should.equal(1);
      done();
    }, 60);
  });
});

describe('ui settings', () => {
  const fakeStorage = () => {
    const data = {};
    return {
      data,
      getItem: (k) => (k in data ? data[k] : null),
      setItem: (k, v) => {
        data[k] = v;
      },
    };
  };

  it('merges patches into what is stored', () => {
    const storage = fakeStorage();
    const s = settings.create(() => storage);

    s.save({ theme: 'dark' });
    s.save({ wrap: true });

    s.load().should.eql({ theme: 'dark', wrap: true });
    JSON.parse(storage.data[settings.STORAGE_KEY]).wrap.should.be.true;
  });

  it('returns {} when nothing is stored or the data is corrupt', () => {
    const storage = fakeStorage();
    const s = settings.create(() => storage);

    s.load().should.eql({});
    storage.data[settings.STORAGE_KEY] = '{not json';
    s.load().should.eql({});
  });

  it('survives unavailable storage (private browsing, blocked data)', () => {
    const broken = settings.create(() => {
      throw new Error('SecurityError');
    });

    broken.load().should.eql({});
    (() => broken.save({ a: 1 })).should.not.throw();

    const quota = settings.create(() => ({
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    }));
    (() => quota.save({ a: 1 })).should.not.throw();
  });
});

describe('ui filters', () => {
  const base = {
    filterValue: '',
    regexMode: false,
    caseSensitive: false,
    invertFilter: false,
    selectedSource: null,
    levelFilters: { error: true, warn: true, info: true, debug: true },
  };
  const state = (patch) => ({ ...base, ...patch });

  it('shows everything without a filter', () => {
    filters.isVisible('anything', 's', base).should.be.true;
  });

  it('plain text filter is case-insensitive by default and escapes metacharacters', () => {
    filters.matchesText('Disk FULL', state({ filterValue: 'disk full' })).should.be.true;
    filters.matchesText('a1b', state({ filterValue: 'a.b' })).should.be.false; // "." is literal
    filters.matchesText('a.b', state({ filterValue: 'a.b' })).should.be.true;
  });

  it('honours case-sensitive, regex and invert', () => {
    filters.matchesText('Disk', state({ filterValue: 'disk', caseSensitive: true })).should.be.false;
    filters.matchesText('error 42', state({ filterValue: 'error \\d+', regexMode: true })).should.be.true;
    filters.matchesText('ok', state({ filterValue: 'error', invertFilter: true })).should.be.true;
    filters.matchesText('an error', state({ filterValue: 'error', invertFilter: true })).should.be.false;
  });

  it('an invalid regex hides nothing', () => {
    filters.matchesText('x', state({ filterValue: '(', regexMode: true })).should.be.true;
    (filters.buildRegex(state({ filterValue: '(', regexMode: true })) === null).should.be.true;
  });

  it('reuses the compiled regex while the filter is unchanged', () => {
    const s = state({ filterValue: 'abc' });

    filters.buildRegex(s).should.equal(filters.buildRegex({ ...s }));
    filters.buildRegex(state({ filterValue: 'abd' })).should.not.equal(filters.buildRegex(s));
    // same text but different flags is a different regex
    filters.buildRegex(state({ filterValue: 'abc', caseSensitive: true })).flags.should.equal('');
    filters.buildRegex(s).flags.should.equal('i');
  });

  it('filters by selected source', () => {
    filters.matchesSource('a.log', state({ selectedSource: 'a.log' })).should.be.true;
    filters.matchesSource('b.log', state({ selectedSource: 'a.log' })).should.be.false;
    filters.matchesSource('b.log', base).should.be.true;
  });

  it('level chips hide classified lines only', () => {
    const noWarn = state({ levelFilters: { ...base.levelFilters, warn: false } });

    filters.matchesLevel('disk WARNING 91%', noWarn).should.be.false;
    filters.matchesLevel('ERROR boom', noWarn).should.be.true;
    filters.matchesLevel('GET /index.html 200', noWarn).should.be.true; // no level: never hidden
  });

  it('combines text, source and level (all must match)', () => {
    const s = state({ filterValue: 'disk', selectedSource: 'a.log', levelFilters: { ...base.levelFilters, info: false } });

    filters.isVisible('disk ERROR', 'a.log', s).should.be.true;
    filters.isVisible('disk ERROR', 'b.log', s).should.be.false;
    filters.isVisible('disk INFO ok', 'a.log', s).should.be.false;
    filters.isVisible('cpu ERROR', 'a.log', s).should.be.false;
  });

  it('highlights matches in html without touching tags', () => {
    const html = '<span class="x">disk</span> Disk full';

    filters.highlightMatches(html, state({ filterValue: 'disk' })).should.equal(
      '<span class="x"><mark class="search-highlight">disk</mark></span> <mark class="search-highlight">Disk</mark> full'
    );
    filters.highlightMatches(html, base).should.equal(html);
  });
});

describe('ui highlight', () => {
  it('wraps server preset words in styled spans, outside tags', () => {
    const config = { words: { err: 'color: red;' } };

    highlight
      .applyServerWords('an err here <i class="err">err</i>', config)
      .should.equal('an <span style="color: red;">err</span> here <i class="err"><span style="color: red;">err</span></i>');
    highlight.applyServerWords('x', null).should.equal('x');
  });

  it('styles the whole line element for matching line keys', () => {
    const attrs = {};
    const el = { setAttribute: (k, v) => { attrs[k] = v; } };

    highlight.applyServerLine('this is an err line', el, { lines: { err: 'font-weight: bold;' } }).should.equal(el);
    attrs.style.should.equal('font-weight: bold;');
  });

  it('cycles user keyword classes, case-insensitively', () => {
    const html = highlight.applyKeywords('Error and warn and error', [{ word: 'error' }, { word: 'warn' }], ['c0', 'c1']);

    html.should.equal('<span class="c0">Error</span> and <span class="c1">warn</span> and <span class="c0">error</span>');
    highlight.applyKeywords('a b', [{ word: 'a' }, { word: 'b' }, { word: 'a' }], ['k0', 'k1']).should.containEql('k0');
  });
});
