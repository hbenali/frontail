/* global Tinycon:false, ansi_up:false */

window.App = (function app(window, document) {
  'use strict';

  // ── Private state ─────────────────────────────────────────────
  var _socket;
  var _logContainer;
  var _filterInput;
  var _pauseBtn;
  var _topbar;
  var _body;

  var _filterValue     = '';
  var _isPaused        = false;
  var _skipCounter     = 0;
  var _linesLimit      = Infinity;
  var _newLinesCount   = 0;
  var _isWindowFocused = true;
  var _highlightConfig = null;
  var _totalLines      = 0;
  var _visibleLines    = 0;
  var _errorCount      = 0;
  var _warnCount       = 0;
  var _lineNumber      = 0;
  var _isAtBottom      = true;
  var _wrapEnabled     = false;
  var _timestampEnabled = false;
  var _regexMode       = false;
  var _caseSensitive   = false;
  var _invertFilter    = false;
  var _levelFilters    = { error: true, warn: true, info: true, debug: true };
  var _savedFilters    = [];
  var _fabNewLines     = 0;
  var _userHighlights  = [];
  var _colorsEnabled   = true;
  var _colorsServerDefault = true;
  var _ansiSources     = {};

  var _highlightCssClasses = [
    'kw-highlight-0','kw-highlight-1','kw-highlight-2',
    'kw-highlight-3','kw-highlight-4'
  ];
  var _highlightAccentColors = ['#4f8ef7','#f77070','#6ad19e','#f7b955','#c084fc'];

  // ── LocalStorage persistence ───────────────────────────────────
  var STORAGE_KEY = 'frontail:settings';

  function _loadSettings() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch(e) { return {}; }
  }

  function _saveSettings(patch) {
    try {
      var current = _loadSettings();
      var merged  = { ...current, ...patch};
      localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
    } catch (e) { /* localStorage unavailable (private browsing, quota, etc.) */ }
  }

  // DOM refs
  var _elTotalLines, _elVisibleLines, _elErrorCount, _elWarnCount;
  var _elFilterClear, _elRegexMode, _elCaseSensitive, _elInvertFilter;
  var _elLevelChips;
  var _elSavedFilterName, _elSavedFilterSave, _elSavedFilterList;
  var _elDownloadFilteredBtn;
  var _elHighlightInput, _elHighlightAdd, _elHighlightList;
  var _elPauseLabel, _elPauseIcon;
  var _elClearBtn, _elWrapBtn, _elTimestampBtn, _elColorsBtn;
  var _elAnsiBadge, _elDownloadSanitizedBtn;
  var _elConnDot, _elConnText;
  var _elLiveIndicator;
  var _elSkippedBadge, _elSkippedCount;
  var _elEmptyState;
  var _elFabScroll, _elFabCount;
  var _elUpdateBanner, _elUpdateRefreshBtn, _elUpdateDismissBtn;
  var _elLogViewport;
  var _elSidebarCollapse, _elExpandSidebar;
  var _toastContainer;
  var _elSourceList;
  var _elTopbarTitle, _elTopbarTitleIcon, _elTopbarCount, _elTopbarFilteredDot;
  var _selectedSource = null;
  var _sources        = [];
  var _isContainer    = false;

  // ── Utilities ─────────────────────────────────────────────────

  function _debounce(fn, ms) {
    var t;
    return function() { clearTimeout(t); t = setTimeout(fn, ms); };
  }

  function _escapeRegExp(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function _escapeHtml(str) {
    return str
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function _basename(p) {
    if (!p) return p;
    var parts = String(p).split('/');
    return parts[parts.length - 1] || p;
  }

  var FILE_ICON_SVG = '<svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M2.5 1h4.5l2.5 2.5V10a1 1 0 01-1 1h-6a1 1 0 01-1-1V2a1 1 0 011-1z" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round"/><path d="M7 1v2.5h2.5" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round"/></svg>';
  var CONTAINER_ICON_SVG = '<svg width="11" height="11" viewBox="0 0 12 12" fill="none"><rect x="1.5" y="0.5" width="9" height="7" rx="1.5" stroke="currentColor" stroke-width="1.1"/><rect x="3.5" y="2" width="5" height="4" rx="0.8" stroke="currentColor" stroke-width="0.8"/><circle cx="6" cy="9.5" r="1.2" stroke="currentColor" stroke-width="0.9"/></svg>';
  var LAYERS_ICON_SVG = '<svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M6 1l5 2.5L6 6 1 3.5 6 1z" stroke="currentColor" stroke-width="1" stroke-linejoin="round"/><path d="M1 6l5 2.5L11 6" stroke="currentColor" stroke-width="1" stroke-linejoin="round"/><path d="M1 8.5l5 2.5 5-2.5" stroke="currentColor" stroke-width="1" stroke-linejoin="round"/></svg>';

  function _showToast(msg, duration) {
    if (!_toastContainer) return;
    var el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    _toastContainer.appendChild(el);
    setTimeout(function() {
      el.style.opacity = '0';
      el.style.transition = 'opacity 0.3s';
      setTimeout(function() { if (el.parentNode) el.parentNode.removeChild(el); }, 300);
    }, duration || 2000);
  }

  // ── Deployed-version check ──────────────────────────────────────
  // The version baked into this page load vs. whatever the server reports
  // on each socket (re)connect. A mismatch means the server process was
  // restarted with a new release while this tab was open (e.g. a redeploy) -
  // the socket reconnects automatically, but the page's JS/HTML is stale.

  var _updateBannerDismissed = false;

  function _checkDeployedVersion(serverVersion) {
    var pageVersion = window._frontailVersion;
    if (!pageVersion || !serverVersion || pageVersion === serverVersion) return;
    if (_updateBannerDismissed) return;
    if (_elUpdateBanner) _elUpdateBanner.classList.remove('hidden');
  }

  // ── Byte formatter ────────────────────────────────────────────
  function _formatBytes(bytes) {
    if (bytes < 1024)        return bytes + ' B';
    if (bytes < 1048576)     return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1073741824)  return (bytes / 1048576).toFixed(1) + ' MB';
    return (bytes / 1073741824).toFixed(2) + ' GB';
  }

  // ── Stats ──────────────────────────────────────────────────────

  function _updateStats() {
    if (_elTotalLines)   _elTotalLines.textContent   = _totalLines;
    if (_elVisibleLines) _elVisibleLines.textContent = _visibleLines;
    if (_elErrorCount)   _elErrorCount.textContent   = _errorCount;
    if (_elWarnCount)    _elWarnCount.textContent     = _warnCount;
  }

  // ── Level detection ────────────────────────────────────────────

  function _detectLevel(text) {
    var t = text.toLowerCase();
    if (/\b(error|err|fatal|critical|crit|exception|traceback)\b/.test(t)) return 'error';
    if (/\b(warn|warning)\b/.test(t)) return 'warn';
    if (/\b(info|information)\b/.test(t)) return 'info';
    if (/\b(debug|trace|verbose)\b/.test(t)) return 'debug';
    return '';
  }

  // ── ANSI detection ──────────────────────────────────────────────

  // eslint-disable-next-line no-control-regex
  var ANSI_RX = /\x1b\[[0-9;]*[a-zA-Z]/;

  function _hasAnsiCodes(text) {
    return ANSI_RX.test(text);
  }

  // ── Format autodetect colorizer (apache2 / nginx / tomcat / syslog) ──
  // Only ever applied to lines WITHOUT embedded ANSI codes — those already
  // carry their own colors via ansi_up and are left untouched.

  function _fcSpan(cls, text) {
    return '<span class="log-fc-' + cls + '">' + text + '</span>';
  }

  function _fcStatusClass(code) {
    var c = String(code).charAt(0);
    if (c === '2') return 'status-2xx';
    if (c === '3') return 'status-3xx';
    if (c === '4') return 'status-4xx';
    if (c === '5') return 'status-5xx';
    return 'status-other';
  }

  function _fcLevelClass(word) {
    var w = (word || '').toLowerCase();
    if (/^(emerg|alert|crit|severe|error|err|fatal)/.test(w)) return 'level-error';
    if (/^warn/.test(w)) return 'level-warn';
    if (/^(notice|info)/.test(w)) return 'level-info';
    return 'level-debug';
  }

  // ── JSON log line colorizing ─────────────────────────────────────
  // Structured JSON-lines logs (pino/winston-json/bunyan/Go structured
  // logging, etc.) get rendered as colorized key=value pairs instead of
  // raw escaped JSON text. Takes priority over every other rule below.

  var JSON_FIELD_CLASS = {
    level: 'level', severity: 'level', lvl: 'level',
    time: 'time', timestamp: 'time', '@timestamp': 'time', ts: 'time',
    status: 'status', statuscode: 'status', status_code: 'status',
    ip: 'ip', remoteaddr: 'ip', remote_addr: 'ip',
  };

  function _jsonFieldSpan(key, valueText) {
    var cls = JSON_FIELD_CLASS[key.toLowerCase()];
    if (cls === 'level') return _fcSpan(_fcLevelClass(valueText), valueText);
    if (cls === 'status') return _fcSpan(_fcStatusClass(valueText), valueText);
    if (cls) return _fcSpan(cls, valueText);
    if (key.toLowerCase() === 'msg' || key.toLowerCase() === 'message') return valueText;
    return _fcSpan('field', valueText);
  }

  function _tryColorizeJson(raw) {
    var trimmed = raw.trim();
    if (trimmed.charAt(0) !== '{' || trimmed.charAt(trimmed.length - 1) !== '}') return null;
    var obj;
    try { obj = JSON.parse(trimmed); } catch (e) { return null; }
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
    var keys = Object.keys(obj);
    if (!keys.length) return null;
    var parts = keys.map(function(key) {
      var val = obj[key];
      var valStr = typeof val === 'string' ? val : JSON.stringify(val);
      var escKey = ansi_up.escape_for_html(key);
      var escVal = ansi_up.escape_for_html(valStr);
      return _fcSpan('jkey', escKey) + '=' + _jsonFieldSpan(key, escVal);
    });
    return parts.join(' ');
  }

  var _FORMAT_RULES = [
    { // Apache/Nginx combined or common access log
      regex: /^(\S+) (\S+) (\S+) \[([^\]]+)\] "([A-Z]+) (\S*) (HTTP\/\d\.\d)" (\d{3}) (\S+)/,
      render(m) {
        return _fcSpan('ip', m[1]) + ' ' + m[2] + ' ' + m[3] + ' [' +
          _fcSpan('time', m[4]) + '] "' + _fcSpan('method', m[5]) + ' ' +
          _fcSpan('path', m[6]) + ' ' + _fcSpan('proto', m[7]) + '" ' +
          _fcSpan(_fcStatusClass(m[8]), m[8]) + ' ' + _fcSpan('size', m[9]);
      }
    },
    { // Nginx error log: 2024/01/01 12:00:00 [error] 1234#0: message
      regex: /^(\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}) \[(\w+)\] (\d+#\d+):/,
      render(m) {
        return _fcSpan('time', m[1]) + ' [' + _fcSpan(_fcLevelClass(m[2]), m[2]) + '] ' +
          _fcSpan('pid', m[3]) + ':';
      }
    },
    { // Apache error log, both classic and current formats
      regex: /^\[([^\]]+)\] \[([\w:]+)\](?: \[(pid \d+|client [^\]]+)\])?/,
      render(m) {
        var out = '[' + _fcSpan('time', m[1]) + '] [' +
          _fcSpan(_fcLevelClass(m[2].split(':').pop()), m[2]) + ']';
        if (m[3]) out += ' [' + _fcSpan('meta', m[3]) + ']';
        return out;
      }
    },
    { // Tomcat 8.5+/9/10 one-line juli format:
      // 12-Jan-2024 15:15:22.123 INFO [main] org.apache.catalina.startup.Catalina.start
      regex: /^(\d{2}-\w{3}-\d{4} \d{2}:\d{2}:\d{2}\.\d{3}) (SEVERE|WARNING|INFO|CONFIG|FINE|FINER|FINEST) \[([^\]]+)\] (\S+)/,
      render(m) {
        return _fcSpan('time', m[1]) + ' ' + _fcSpan(_fcLevelClass(m[2]), m[2]) + ' [' +
          _fcSpan('thread', m[3]) + '] ' + _fcSpan('logger', m[4]);
      }
    },
    { // Classic Tomcat juli header line: Jan 12, 2024 3:15:22 PM org.apache.catalina.core.StandardService log
      regex: /^(\w{3} \d{1,2}, \d{4} \d{1,2}:\d{2}:\d{2} [AP]M) (\S+) (\S+)$/,
      render(m) {
        return _fcSpan('time', m[1]) + ' ' + _fcSpan('logger', m[2]) + ' ' + _fcSpan('method', m[3]);
      }
    },
    { // Classic Tomcat juli level line: INFO: message / SEVERE: message
      regex: /^(SEVERE|WARNING|INFO|CONFIG|FINE|FINER|FINEST):/,
      render(m) {
        return _fcSpan(_fcLevelClass(m[1]), m[1]) + ':';
      }
    },
    { // Generic syslog: Aug 12 10:15:23 myhost sshd[1234]: message
      regex: /^(\w{3}\s+\d{1,2} \d{2}:\d{2}:\d{2}) (\S+) ([\w.\-/]+)(\[\d+\])?:/,
      render(m) {
        return _fcSpan('time', m[1]) + ' ' + _fcSpan('host', m[2]) + ' ' +
          _fcSpan('logger', m[3]) + (m[4] ? _fcSpan('pid', m[4]) : '') + ':';
      }
    },
    { // Log4j/Logback pipe-delimited: 2024-01-01 12:00:00,000 | INFO | message [logger<thread>]
      regex: /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}[.,]\d{3})\s*\|\s*(\w+)\s*\|\s*/,
      render(m) {
        return _fcSpan('time', m[1]) + ' | ' + _fcSpan(_fcLevelClass(m[2]), m[2]) + ' | ';
      }
    }
  ];

  // ── User-extensible format rules ────────────────────────────────
  // Declarative rules supplied by the server (--ui-colors-preset) as
  // [{ regex, flags, template }]. template placeholders are {N} (group N,
  // unstyled) or {N:spec} where spec is "status" / "level" (auto-classed),
  // a class name (-> log-fc-<name>), or a literal color ("#fff", "rgb(...)").

  var _userFormatRules = [];

  function _fcSpanBySpec(spec, text) {
    if (!spec) return text;
    if (spec === 'status') return _fcSpan(_fcStatusClass(text), text);
    if (spec === 'level') return _fcSpan(_fcLevelClass(text), text);
    if (/^(#|rgb|hsl)/i.test(spec)) {
      return '<span style="color:' + spec.replace(/"/g, '') + '">' + text + '</span>';
    }
    return _fcSpan(spec, text);
  }

  function _compileUserFormatRule(spec) {
    if (!spec || typeof spec.regex !== 'string' || typeof spec.template !== 'string') return null;
    var regex;
    try {
      regex = new RegExp(spec.regex, spec.flags || '');
    } catch (e) { return null; }
    var {template} = spec;
    return {
      regex,
      render(m) {
        return template.replace(/\{(\d+)(?::([^}]+))?\}/g, function(whole, idx, clsSpec) {
          var val = m[Number(idx)];
          if (val === undefined) return '';
          return _fcSpanBySpec(clsSpec, val);
        });
      }
    };
  }

  // ── Generic fallback: token-level coloring for any format not matched
  // above — timestamps, log levels, IPs, bracketed metadata, quoted strings.

  var GENERIC_FC_RX = new RegExp(
    '(\\d{4}-\\d{2}-\\d{2}[ T]\\d{2}:\\d{2}:\\d{2}(?:[.,]\\d+)?(?:Z|[+-]\\d{2}:?\\d{2})?)' +
    '|((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\\s+\\d{1,2}\\s+\\d{2}:\\d{2}:\\d{2})' +
    '|(\\b(?:TRACE|DEBUG|INFO|NOTICE|WARNING|WARN|ERROR|ERR|SEVERE|FATAL|CRITICAL|CRIT|EMERGENCY|EMERG|ALERT)\\b)' +
    '|(\\b(?:\\d{1,3}\\.){3}\\d{1,3}\\b)' +
    '|(\\[[^\\[\\]]{1,300}\\])' +
    '|("[^"]{0,200}")',
    'gi'
  );

  function _applyGenericColors(html) {
    return html.replace(GENERIC_FC_RX, function(m, time1, time2, level, ip, bracket, quoted) {
      if (time1 || time2) return _fcSpan('time', m);
      if (level) return _fcSpan(_fcLevelClass(m), m);
      if (ip) return _fcSpan('ip', m);
      if (bracket) return _fcSpan('meta', m);
      if (quoted) return _fcSpan('str', m);
      return m;
    });
  }

  function _applyFormatColors(html) {
    var rules = _userFormatRules.concat(_FORMAT_RULES);
    for (var i = 0; i < rules.length; i++) {
      rules[i].regex.lastIndex = 0; // defensive: user-supplied rules may carry a 'g' flag
      var m = rules[i].regex.exec(html);
      if (m) {
        return html.slice(0, m.index) + rules[i].render(m) + html.slice(m.index + m[0].length);
      }
    }
    return _applyGenericColors(html);
  }

  function _colorizeLine(data) {
    var hasAnsi = _hasAnsiCodes(data);
    var html;
    if (_colorsEnabled) {
      var jsonHtml = hasAnsi ? null : _tryColorizeJson(data);
      if (jsonHtml !== null) {
        html = jsonHtml;
      } else {
        html = ansi_up.escape_for_html(data);
        html = ansi_up.ansi_to_html(html);
        if (!hasAnsi) html = _applyFormatColors(html);
      }
    } else {
      html = ansi_up.escape_for_html(ansi_up.ansi_to_text(data));
    }
    return { html, hasAnsi };
  }

  // ── Filter ─────────────────────────────────────────────────────

  function _buildFilterRegex() {
    if (!_filterValue) return null;
    try {
      var pattern = _regexMode ? _filterValue : _escapeRegExp(_filterValue);
      return new RegExp(pattern, _caseSensitive ? '' : 'i');
    } catch(e) { return null; }
  }

  function _lineMatchesFilter(text) {
    if (!_filterValue) return true;
    var rx = _buildFilterRegex();
    if (!rx) return true;
    return _invertFilter ? !rx.test(text) : rx.test(text);
  }

  function _sourceMatchesFilter(source) {
    if (!_selectedSource) return true;
    return source === _selectedSource;
  }

  function _lineMatchesLevelFilter(text) {
    var level = _detectLevel(text);
    if (!level) return true; // unclassified lines are never hidden by level chips
    return !!_levelFilters[level];
  }

  function _lineIsVisible(text, source) {
    return _lineMatchesFilter(text) && _sourceMatchesFilter(source) && _lineMatchesLevelFilter(text);
  }

  function _filterElement(el) {
    var text = el.getAttribute('data-raw') || el.textContent;
    var source = el.getAttribute('data-source');
    if (_lineIsVisible(text, source)) {
      el.classList.remove('filtered-out');
      return true;
    }
    el.classList.add('filtered-out');
    return false;
  }

  function _filterAllLogs() {
    var children = _logContainer ? _logContainer.children : [];
    var visible  = 0;
    for (var i = 0; i < children.length; i++) {
      if (_filterElement(children[i])) visible++;
    }
    _visibleLines = visible;
    _updateStats();
    _updateTopbarFilterIndicator();
    if (_isAtBottom) _scrollToBottom();
  }

  // ── Level quick-filter chips ────────────────────────────────────

  function _renderLevelChips() {
    if (!_elLevelChips) return;
    var chips = _elLevelChips.querySelectorAll('.level-chip');
    for (var i = 0; i < chips.length; i++) {
      var lvl = chips[i].getAttribute('data-level');
      chips[i].classList.toggle('active', !!_levelFilters[lvl]);
    }
  }

  function _toggleLevelFilter(level) {
    _levelFilters[level] = !_levelFilters[level];
    _saveSettings({ levelFilters: _levelFilters });
    _renderLevelChips();
    _filterAllLogs();
  }

  // ── Saved filter presets ─────────────────────────────────────────

  function _renderSavedFilters() {
    if (!_elSavedFilterList) return;
    _elSavedFilterList.innerHTML = '';
    _savedFilters.forEach(function(f, idx) {
      var tag = document.createElement('div');
      tag.className = 'saved-filter-tag';
      tag.innerHTML =
        '<button class="saved-filter-apply" data-idx="' + idx + '" title="' + _escapeHtml(f.value) + '">' + _escapeHtml(f.name) + '</button>' +
        '<button class="remove-tag" data-idx="' + idx + '" aria-label="Delete saved filter">' +
        '<svg width="10" height="10" viewBox="0 0 10 10" fill="none">' +
        '<path d="M1.5 1.5l7 7M8.5 1.5l-7 7" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>' +
        '</svg></button>';
      tag.querySelector('.saved-filter-apply').addEventListener('click', function(e) {
        var i = parseInt(e.currentTarget.getAttribute('data-idx'), 10);
        _applySavedFilter(_savedFilters[i]);
      });
      tag.querySelector('.remove-tag').addEventListener('click', function(e) {
        var i = parseInt(e.currentTarget.getAttribute('data-idx'), 10);
        _savedFilters.splice(i, 1);
        _saveSettings({ savedFilters: _savedFilters });
        _renderSavedFilters();
      });
      _elSavedFilterList.appendChild(tag);
    });
  }

  function _applySavedFilter(f) {
    if (!f) return;
    _filterValue = f.value || '';
    _regexMode = !!f.regexMode;
    _caseSensitive = !!f.caseSensitive;
    _invertFilter = !!f.invertFilter;
    if (_filterInput) _filterInput.value = _filterValue;
    if (_elRegexMode) _elRegexMode.checked = _regexMode;
    if (_elCaseSensitive) _elCaseSensitive.checked = _caseSensitive;
    if (_elInvertFilter) _elInvertFilter.checked = _invertFilter;
    if (_elFilterClear) _elFilterClear.classList.toggle('hidden', !_filterValue);
    _setFilterParam(_filterValue);
    _saveSettings({
      filter: _filterValue, regexMode: _regexMode,
      caseSensitive: _caseSensitive, invertFilter: _invertFilter
    });
    _filterAllLogs();
    _reHighlightAll();
    _showToast('Applied filter "' + f.name + '"');
  }

  function _saveCurrentFilter(name) {
    name = (name || '').trim();
    if (!name) return;
    if (!_filterValue) { _showToast('Type a filter before saving'); return; }
    var entry = {
      name, value: _filterValue, regexMode: _regexMode,
      caseSensitive: _caseSensitive, invertFilter: _invertFilter
    };
    for (var i = 0; i < _savedFilters.length; i++) {
      if (_savedFilters[i].name.toLowerCase() === name.toLowerCase()) {
        _savedFilters[i] = entry;
        _saveSettings({ savedFilters: _savedFilters });
        _renderSavedFilters();
        _showToast('Updated saved filter "' + name + '"');
        return;
      }
    }
    _savedFilters.push(entry);
    _saveSettings({ savedFilters: _savedFilters });
    _renderSavedFilters();
    if (_elSavedFilterName) _elSavedFilterName.value = '';
    _showToast('Saved filter "' + name + '"');
  }

  // ── Export currently visible lines ──────────────────────────────

  function _downloadFilteredView() {
    if (!_logContainer) return;
    var lines = _logContainer.querySelectorAll('.log-line:not(.filtered-out)');
    if (!lines.length) { _showToast('Nothing visible to download'); return; }
    var text = Array.prototype.map.call(lines, function(el) {
      return el.getAttribute('data-raw') || '';
    }).join('\n');
    var blob = new Blob([text], { type: 'text/plain' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'filtered-logs.txt';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(function() {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 200);
    _showToast('Downloaded ' + lines.length + ' visible line' + (lines.length === 1 ? '' : 's'));
  }

  // ── URL params ─────────────────────────────────────────────────

  function _setFilterValueFromURL() {
    var fromURL = new URL(window.location.toString()).searchParams.get('filter');
    if (fromURL != null) {
      _filterValue = fromURL;
      if (_filterInput) _filterInput.value = fromURL;
    }
  }

  function _setFilterParam(value) {
    var url = new URL(window.location.toString());
    var p   = new URLSearchParams(url.search.slice(1));
    if (value === '') p.delete('filter'); else p.set('filter', value);
    url.search = p.toString();
    window.history.replaceState(null, document.title, url.toString());
  }

  // ── Favicon ────────────────────────────────────────────────────

  function _faviconReset() { _newLinesCount = 0; Tinycon.setBubble(0); }

  function _updateFaviconCounter() {
    if (_isWindowFocused || _isPaused) return;
    if (_newLinesCount < 99) { _newLinesCount++; Tinycon.setBubble(_newLinesCount); }
  }

  // ── Highlight: server ─────────────────────────────────────────

  function _applyServerHighlightWord(line) {
    var out = line;
    if (_highlightConfig && _highlightConfig.words) {
      Object.keys(_highlightConfig.words).forEach(function(w) {
        out = out.replace(
          new RegExp(_escapeRegExp(w), 'g'),
          '<span style="' + _highlightConfig.words[w] + '">' + w + '</span>'
        );
      });
    }
    return out;
  }

  function _applyServerHighlightLine(text, container) {
    if (_highlightConfig && _highlightConfig.lines) {
      Object.keys(_highlightConfig.lines).forEach(function(check) {
        if (text.indexOf(check) !== -1) {
          container.setAttribute('style', _highlightConfig.lines[check]);
        }
      });
    }
    return container;
  }

  // ── Highlight: user keywords ───────────────────────────────────

  function _applyUserHighlights(html) {
    _userHighlights.forEach(function(h, idx) {
      var cls = _highlightCssClasses[idx % _highlightCssClasses.length];
      html = html.replace(
        new RegExp('(?![^<]*>)(' + _escapeRegExp(h.word) + ')', 'gi'),
        '<span class="' + cls + '">$1</span>'
      );
    });
    return html;
  }

  function _applyFilterHighlight(html) {
    if (!_filterValue) return html;
    var rx = _buildFilterRegex();
    if (!rx) return html;
    return html.replace(
      new RegExp('(?![^<]*>)(' + rx.source + ')', _caseSensitive ? 'g' : 'gi'),
      '<mark class="search-highlight">$1</mark>'
    );
  }

  // ── ANSI indicator ──────────────────────────────────────────────
  // Tracked per source name, so the badge/Sanitized button reflect
  // whichever source(s) are currently in view — not just "seen once, ever".

  function _ansiIndicatorState() {
    var names = (_sources && _sources.length) ? _sources.map(function(s) { return s.name; }) : Object.keys(_ansiSources);
    if (_selectedSource) return _ansiSources[_selectedSource] ? 'all' : 'none';
    if (!names.length) return 'none';
    var withAnsi = names.filter(function(n) { return _ansiSources[n]; }).length;
    if (withAnsi === 0) return 'none';
    return withAnsi === names.length ? 'all' : 'mixed';
  }

  function _updateAnsiIndicator() {
    var state = _ansiIndicatorState();
    if (_elAnsiBadge) {
      _elAnsiBadge.classList.toggle('hidden', state === 'none');
      _elAnsiBadge.textContent = state === 'mixed' ? 'Mixed colors' : 'ANSI colors';
    }
    if (_elDownloadSanitizedBtn) _elDownloadSanitizedBtn.classList.toggle('hidden', state === 'none');
  }

  function _onAnsiDetected(source) {
    _ansiSources[source] = true;
    _updateAnsiIndicator();
    _showToast((source ? '"' + source + '"' : 'Source') + ' already contains ANSI colors — autodetected format colorizing skipped for those lines');
  }

  // ── Scroll ─────────────────────────────────────────────────────

  function _checkScrollPosition() {
    var vp = _elLogViewport;
    if (!vp) return;
    _isAtBottom = vp.scrollHeight - vp.scrollTop - vp.clientHeight < 60;
    if (_isAtBottom) { _fabNewLines = 0; _updateFab(); }
    if (_elFabScroll) _elFabScroll.classList.toggle('visible', !_isAtBottom);
  }

  function _scrollToBottom() {
    if (_elLogViewport) _elLogViewport.scrollTop = _elLogViewport.scrollHeight;
  }

  function _updateFab() {
    if (!_elFabCount) return;
    _elFabCount.textContent = _fabNewLines > 0 ? '+' + _fabNewLines : '';
  }

  // ── Sidebar ────────────────────────────────────────────────────

  function _setSidebarCollapsed(collapsed) {
    var sidebar = document.getElementById('sidebar');
    if (sidebar) {
      sidebar.classList.toggle('collapsed', collapsed);
      sidebar.setAttribute('aria-hidden', collapsed ? 'true' : 'false');
    }
    if (_elSidebarCollapse) _elSidebarCollapse.setAttribute('aria-expanded', !collapsed);
    if (_elExpandSidebar) {
      _elExpandSidebar.classList.toggle('hidden', !collapsed);
      _elExpandSidebar.setAttribute('aria-expanded', !collapsed);
    }
    _saveSettings({ sidebarCollapsed: collapsed });
  }

  // ── Source selector ─────────────────────────────────────────────

  function _buildSourceSelector(sources) {
    if (!_elSourceList || !sources || sources.length <= 1) {
      if (_elSourceList) _elSourceList.classList.remove('has-pills');
      return;
    }
    _elSourceList.classList.add('has-pills');
    _elSourceList.innerHTML = '';

    var allChip = document.createElement('button');
    allChip.className = 'source-chip active';
    allChip.setAttribute('data-source', '');
    allChip.textContent = 'All';
    allChip.addEventListener('click', function() { _setSelectedSource(null); });
    _elSourceList.appendChild(allChip);

    for (var i = 0; i < sources.length; i++) {
      var s = sources[i];
      var chip = document.createElement('button');
      chip.className = 'source-chip';
      chip.setAttribute('data-source', s.name);
      chip.title = s.name;

      var icon = document.createElement('span');
      icon.className = 'source-chip-icon';
      icon.innerHTML = s.type === 'container'
        ? '<svg width="11" height="11" viewBox="0 0 12 12" fill="none"><rect x="1.5" y="0.5" width="9" height="7" rx="1.5" stroke="currentColor" stroke-width="1.1"/><rect x="3.5" y="2" width="5" height="4" rx="0.8" stroke="currentColor" stroke-width="0.8"/><circle cx="6" cy="9.5" r="1.2" stroke="currentColor" stroke-width="0.9"/></svg>'
        : '<svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M2.5 1h4.5l2.5 2.5V10a1 1 0 01-1 1h-6a1 1 0 01-1-1V2a1 1 0 011-1z" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round"/><path d="M7 1v2.5h2.5" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round"/><path d="M3.5 7h5M3.5 5h5M3.5 9h3" stroke="currentColor" stroke-width="0.8" stroke-linecap="round"/></svg>';
      chip.appendChild(icon);

      var label = document.createElement('span');
      label.className = 'source-chip-label';
      label.textContent = s.name;
      chip.appendChild(label);

      chip.addEventListener('click', function(sourceName) {
        return function() { _setSelectedSource(sourceName); };
      }(s.name));
      _elSourceList.appendChild(chip);
    }
  }

  // ── Topbar title ─────────────────────────────────────────────────

  function _updateTopbarSourceInfo() {
    if (!_elTopbarTitle) return;
    var iconHtml = '';
    var text, full;
    var match = null;
    if (_selectedSource) {
      for (var i = 0; i < _sources.length; i++) {
        if (_sources[i].name === _selectedSource) { match = _sources[i]; break; }
      }
      iconHtml = (match && match.type === 'container') ? CONTAINER_ICON_SVG : FILE_ICON_SVG;
      full = _selectedSource;
      text = _basename(_selectedSource);
    } else if (_sources.length === 1) {
      iconHtml = _sources[0].type === 'container' ? CONTAINER_ICON_SVG : FILE_ICON_SVG;
      full = _sources[0].name;
      text = _basename(_sources[0].name);
    } else if (_sources.length > 1) {
      iconHtml = LAYERS_ICON_SVG;
      full = _sources.map(function(s) { return s.name; }).join(' + ');
      text = 'All sources';
    } else {
      full = 'frontail';
      text = 'frontail';
    }
    if (_elTopbarTitleIcon) _elTopbarTitleIcon.innerHTML = iconHtml;
    _elTopbarTitle.textContent = text;
    _elTopbarTitle.setAttribute('title', full);
    if (_elTopbarCount) {
      var showCount = !_selectedSource && _sources.length > 1;
      _elTopbarCount.classList.toggle('hidden', !showCount);
      if (showCount) _elTopbarCount.textContent = '(' + _sources.length + ')';
    }
  }

  function _updateTopbarFilterIndicator() {
    if (!_elTopbarFilteredDot) return;
    var levelRestricted = !_levelFilters.error || !_levelFilters.warn || !_levelFilters.info || !_levelFilters.debug;
    var active = !!_filterValue || levelRestricted;
    _elTopbarFilteredDot.classList.toggle('hidden', !active);
    _elTopbarFilteredDot.title = active ? 'A filter is active — showing a subset of lines' : '';
  }

  function _setSelectedSource(source) {
    _selectedSource = source;
    if (_elSourceList) {
      var chips = _elSourceList.querySelectorAll('.source-chip');
      for (var i = 0; i < chips.length; i++) {
        var val = chips[i].getAttribute('data-source');
        chips[i].classList.toggle('active', val === (source || ''));
      }
    }
    _updateTopbarSourceInfo();
    _updateAnsiIndicator();
    _filterAllLogs();
  }

  // ── Highlight tag UI ───────────────────────────────────────────

  var _BIP_LABELS = { 'off': '🔕 Off', 'first': '🔔 First', 'each': '🔔 Each' };
  var _BIP_CYCLE  = { 'off': 'first', 'first': 'each', 'each': 'off' };

  function _renderHighlightTags() {
    if (!_elHighlightList) return;
    _elHighlightList.innerHTML = '';
    _userHighlights.forEach(function(h, idx) {
      var color = _highlightAccentColors[idx % _highlightAccentColors.length];
      var bip   = h.bip || 'off';
      var tag   = document.createElement('div');
      tag.className = 'highlight-tag';
      tag.style.borderLeftColor = color;
      tag.innerHTML =
        '<span class="hl-word">' + _escapeHtml(h.word) + '</span>' +
        '<button class="bip-btn" data-idx="' + idx + '" title="Bip mode: ' + bip + '" aria-label="Toggle bip">' +
          _BIP_LABELS[bip] +
        '</button>' +
        '<button class="remove-tag" data-idx="' + idx + '" aria-label="Remove highlight">' +
        '<svg width="10" height="10" viewBox="0 0 10 10" fill="none">' +
        '<path d="M1.5 1.5l7 7M8.5 1.5l-7 7" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>' +
        '</svg></button>';
      tag.querySelector('.bip-btn').addEventListener('click', function(e) {
        var i = parseInt(e.currentTarget.getAttribute('data-idx'), 10);
        var next = _BIP_CYCLE[_userHighlights[i].bip || 'off'];
        _userHighlights[i].bip = next;
        _saveHighlights();
        _renderHighlightTags();
        _showToast('Bip: ' + _userHighlights[i].word + ' → ' + next);
      });
      tag.querySelector('.remove-tag').addEventListener('click', function(e) {
        var i = parseInt(e.currentTarget.getAttribute('data-idx'), 10);
        _userHighlights.splice(i, 1);
        _saveHighlights();
        _renderHighlightTags();
        _reHighlightAll();
      });
      _elHighlightList.appendChild(tag);
    });
  }

  function _saveHighlights() {
    _saveSettings({ highlights: _userHighlights.map(function(h) {
      return { word: h.word, bip: h.bip || 'off' };
    }) });
  }

  function _addHighlight(word, bip) {
    word = (word || '').trim();
    if (!word) return;
    for (var i = 0; i < _userHighlights.length; i++) {
      if (_userHighlights[i].word.toLowerCase() === word.toLowerCase()) {
        _showToast('Already highlighting: ' + word);
        return;
      }
    }
    _userHighlights.push({ word, bip: bip || 'off' });
    _saveHighlights();
    _renderHighlightTags();
    _reHighlightAll();
    if (_elHighlightInput) _elHighlightInput.value = '';
    _showToast('Highlighting: ' + word);
  }

  function _reHighlightAll() {
    if (!_logContainer) return;
    var lines = _logContainer.querySelectorAll('.log-line');
    for (var i = 0; i < lines.length; i++) {
      var raw = lines[i].getAttribute('data-raw') || '';
      var p   = lines[i].querySelector('.line-content p');
      if (!p) continue;
      var {html} = _colorizeLine(raw);
      html = _applyServerHighlightWord(html);
      html = _applyUserHighlights(html);
      if (_filterValue) html = _applyFilterHighlight(html);
      p.innerHTML = html;
    }
  }

  // ── Pause UI ───────────────────────────────────────────────────

  function _setPauseState(paused) {
    _isPaused = paused;
    var btn = document.getElementById('pauseBtn');
    if (btn) btn.classList.toggle('active', paused);

    if (_elPauseLabel) _elPauseLabel.textContent = paused ? 'Resume' : 'Pause';
    if (_elPauseIcon) {
      _elPauseIcon.innerHTML = paused
        ? '<path d="M2.5 2.5l8 4-8 4z" fill="currentColor"/>'
        : '<rect x="1.5" y="1.5" width="3.5" height="10" rx="1" fill="currentColor"/>' +
          '<rect x="8" y="1.5" width="3.5" height="10" rx="1" fill="currentColor"/>';
    }
    if (_elLiveIndicator) _elLiveIndicator.classList.toggle('paused', paused);
    if (!paused) {
      _skipCounter = 0;
      if (_elSkippedBadge) _elSkippedBadge.classList.add('hidden');
    }
  }

  // ── Connection status ──────────────────────────────────────────

  function _setConnStatus(state, text) {
    if (_elConnDot) _elConnDot.className = 'conn-dot ' + state;
    if (_elConnText) _elConnText.textContent = text;
  }

  // ── Timestamp ──────────────────────────────────────────────────

  function _formatTimestamp() {
    var d  = new Date();
    var hh = String(d.getHours()).padStart(2,'0');
    var mm = String(d.getMinutes()).padStart(2,'0');
    var ss = String(d.getSeconds()).padStart(2,'0');
    var ms = String(d.getMilliseconds()).padStart(3,'0');
    return hh + ':' + mm + ':' + ss + '.' + ms;
  }

  // ── Bip (Web Audio) ───────────────────────────────────────────
  var _audioCtx = null;
  // Track which words have already beeped (for 'first' mode)
  var _bipFired = {};

  function _getAudioCtx() {
    if (!_audioCtx) {
      try {
        _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      } catch(e) { return null; }
    }
    return _audioCtx;
  }

  function _playBip(frequency, duration) {
    var ctx = _getAudioCtx();
    if (!ctx) return;
    // Resume if suspended (browser autoplay policy)
    if (ctx.state === 'suspended') ctx.resume();
    var osc  = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type      = 'sine';
    osc.frequency.setValueAtTime(frequency || 880, ctx.currentTime);
    gain.gain.setValueAtTime(0.25, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + (duration || 0.18));
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + (duration || 0.18));
  }

  // Frequencies per highlight slot so each keyword has a distinct pitch
  var _BIP_FREQS = [880, 660, 1046, 554, 784];

  function _checkBip(rawText) {
    _userHighlights.forEach(function(h, idx) {
      if (!h.bip || h.bip === 'off') return;
      var rx = new RegExp(_escapeRegExp(h.word), 'i');
      if (!rx.test(rawText)) return;
      if (h.bip === 'first') {
        var key = h.word.toLowerCase();
        if (_bipFired[key]) return;
        _bipFired[key] = true;
      }
      _playBip(_BIP_FREQS[idx % _BIP_FREQS.length]);
    });
  }

  // Reset 'first' fired state when log is cleared
  function _resetBipFired() { _bipFired = {}; }

  // ── Public API ─────────────────────────────────────────────────

  return {

    init: function init(opts) {
      var self = this;

      _logContainer = opts.container;
      _filterInput  = opts.filterInput;
      _pauseBtn     = opts.pauseBtn;
      _topbar       = opts.topbar;
      _body         = opts.body;

      _elTotalLines    = document.getElementById('totalLines');
      _elVisibleLines  = document.getElementById('visibleLines');
      _elErrorCount    = document.getElementById('errorCount');
      _elWarnCount     = document.getElementById('warnCount');
      _elFilterClear   = document.getElementById('filterClear');
      _elRegexMode     = document.getElementById('regexMode');
      _elCaseSensitive = document.getElementById('caseSensitive');
      _elInvertFilter  = document.getElementById('invertFilter');
      _elLevelChips    = document.getElementById('levelChips');
      _elSavedFilterName = document.getElementById('savedFilterName');
      _elSavedFilterSave = document.getElementById('savedFilterSave');
      _elSavedFilterList = document.getElementById('savedFilterList');
      _elDownloadFilteredBtn = document.getElementById('downloadFilteredBtn');
      _elHighlightInput = document.getElementById('highlightInput');
      _elHighlightAdd  = document.getElementById('highlightAdd');
      _elHighlightList = document.getElementById('highlightList');
      _elPauseLabel    = document.getElementById('pauseLabel');
      _elPauseIcon     = document.getElementById('pauseIcon');
      _elClearBtn      = document.getElementById('clearBtn');
      _elWrapBtn       = document.getElementById('wrapBtn');
      _elTimestampBtn  = document.getElementById('timestampBtn');
      _elColorsBtn     = document.getElementById('colorsBtn');
      _elAnsiBadge     = document.getElementById('ansiBadge');
      _elDownloadSanitizedBtn = document.getElementById('downloadSanitizedBtn');
      _elConnDot       = document.getElementById('connDot');
      _elConnText      = document.getElementById('connText');
      _elLiveIndicator = document.getElementById('liveIndicator');
      _elSkippedBadge  = document.getElementById('skippedBadge');
      _elSkippedCount  = document.getElementById('skippedCount');
      _elEmptyState    = document.getElementById('emptyState');
      _elFabScroll     = document.getElementById('fabScroll');
      _elFabCount      = document.getElementById('fabCount');
      _elUpdateBanner  = document.getElementById('updateBanner');
      _elUpdateRefreshBtn = document.getElementById('updateRefreshBtn');
      _elUpdateDismissBtn = document.getElementById('updateDismissBtn');
      _elLogViewport   = document.getElementById('logViewport');
      _elSidebarCollapse = document.getElementById('sidebarCollapse');
      _elExpandSidebar = document.getElementById('expandSidebar');
      _toastContainer  = document.getElementById('toastContainer');
      var _elReadFromStartBtn = document.getElementById('readFromStartBtn');
      var _elDownloadBtn      = document.getElementById('downloadBtn');
      var _elModalOverlay     = document.getElementById('modalOverlay');
      var _elModalSize        = document.getElementById('modalSize');
      var _elModalCancel      = document.getElementById('modalCancel');
      var _elModalDownload    = document.getElementById('modalDownload');
      var _elModalLoadAnyway  = document.getElementById('modalLoadAnyway');
      var _currentFileIndex   = 0;   // which file in multi-file mode
      _elSourceList = document.getElementById('sourceList');
      _elTopbarTitle = document.getElementById('topbarTitle');
      _elTopbarTitleIcon = document.getElementById('topbarTitleIcon');
      _elTopbarCount = document.getElementById('topbarCount');
      _elTopbarFilteredDot = document.getElementById('topbarFilteredDot');
      // _frontailPath is set by the inline <script> in index.html via __PATH__ substitution
      // Strip trailing slash; if path is exactly '/' reduce to '' so URLs don't double-slash
      var _rawPath = (window._frontailPath || '').trim();
      var _urlPath = (_rawPath === '/' ? '' : _rawPath.replace(/\/$/, ''));

      _setFilterValueFromURL();

      // Filter input
      if (_filterInput) {
        _filterInput.focus();
        _filterInput.addEventListener('keyup', function(e) {
          if (e.keyCode === 27) { this.value = ''; _filterValue = ''; }
          else { _filterValue = this.value; }
          if (_elFilterClear) _elFilterClear.classList.toggle('hidden', !_filterValue);
          _setFilterParam(_filterValue);
          _saveSettings({ filter: _filterValue });
          _filterAllLogs();
          _reHighlightAll();
        });
      }

      if (_elFilterClear) {
        _elFilterClear.addEventListener('click', function() {
          if (_filterInput) { _filterInput.value = ''; _filterInput.focus(); }
          _filterValue = '';
          _elFilterClear.classList.add('hidden');
          _setFilterParam('');
          _saveSettings({ filter: '', regexMode: false, caseSensitive: false, invertFilter: false });
          _filterAllLogs();
          _reHighlightAll();
        });
      }

      if (_elRegexMode) {
        _elRegexMode.addEventListener('change', function() {
          _regexMode = this.checked;
          _saveSettings({ regexMode: _regexMode });
          _filterAllLogs();
        });
      }
      if (_elCaseSensitive) {
        _elCaseSensitive.addEventListener('change', function() {
          _caseSensitive = this.checked;
          _saveSettings({ caseSensitive: _caseSensitive });
          _filterAllLogs();
        });
      }
      if (_elInvertFilter) {
        _elInvertFilter.addEventListener('change', function() {
          _invertFilter = this.checked;
          _saveSettings({ invertFilter: _invertFilter });
          _filterAllLogs();
        });
      }

      // Level quick-filter chips
      if (_elLevelChips) {
        _elLevelChips.addEventListener('click', function(e) {
          var chip = e.target.closest ? e.target.closest('.level-chip') : null;
          if (!chip) return;
          _toggleLevelFilter(chip.getAttribute('data-level'));
        });
      }

      // Saved filters
      if (_elSavedFilterSave) {
        _elSavedFilterSave.addEventListener('click', function() { _saveCurrentFilter(_elSavedFilterName.value); });
      }
      if (_elSavedFilterName) {
        _elSavedFilterName.addEventListener('keydown', function(e) {
          if (e.key === 'Enter') _saveCurrentFilter(this.value);
        });
      }

      // Export currently visible lines
      if (_elDownloadFilteredBtn) {
        _elDownloadFilteredBtn.addEventListener('click', function(e) {
          e.preventDefault();
          _downloadFilteredView();
        });
      }

      // Highlight
      if (_elHighlightAdd) {
        _elHighlightAdd.addEventListener('click', function() { _addHighlight(_elHighlightInput.value); });
      }
      if (_elHighlightInput) {
        _elHighlightInput.addEventListener('keydown', function(e) {
          if (e.key === 'Enter') _addHighlight(this.value);
        });
      }

      // Pause
      if (_pauseBtn) {
        _pauseBtn.addEventListener('click', function() {
          _setPauseState(!_isPaused);
          _saveSettings({ paused: _isPaused });
          _showToast(_isPaused ? 'Paused — buffering new lines' : 'Resumed streaming');
        });
      }

      // Clear
      if (_elClearBtn) {
        _elClearBtn.addEventListener('click', function() {
          if (!_logContainer) return;
          _logContainer.innerHTML = '';
          _totalLines = 0; _visibleLines = 0; _errorCount = 0; _warnCount = 0; _lineNumber = 0;
          _updateStats();
          _resetBipFired();
          if (_elEmptyState) _elEmptyState.classList.remove('hidden');
          _showToast('Log cleared');
        });
      }

      // Word wrap
      if (_elWrapBtn) {
        _elWrapBtn.addEventListener('click', function() {
          _wrapEnabled = !_wrapEnabled;
          if (_logContainer) _logContainer.classList.toggle('wrap', _wrapEnabled);
          _elWrapBtn.classList.toggle('active', _wrapEnabled);
          _saveSettings({ wrap: _wrapEnabled });
          _showToast(_wrapEnabled ? 'Word wrap on' : 'Word wrap off');
        });
      }

      // Timestamps
      if (_elTimestampBtn) {
        _elTimestampBtn.addEventListener('click', function() {
          _timestampEnabled = !_timestampEnabled;
          _elTimestampBtn.classList.toggle('active', _timestampEnabled);
          var stamps = document.querySelectorAll('.line-timestamp');
          for (var i = 0; i < stamps.length; i++) {
            stamps[i].classList.toggle('hidden', !_timestampEnabled);
          }
          _saveSettings({ timestamps: _timestampEnabled });
          _showToast(_timestampEnabled ? 'Timestamps visible' : 'Timestamps hidden');
        });
      }

      // Colors (ANSI + format autodetect colorizing)
      if (_elColorsBtn) {
        _elColorsBtn.addEventListener('click', function() {
          _colorsEnabled = !_colorsEnabled;
          _elColorsBtn.classList.toggle('active', _colorsEnabled);
          _saveSettings({ colors: _colorsEnabled });
          _reHighlightAll();
          _showToast(_colorsEnabled ? 'Log colorizing on' : 'Log colorizing off');
        });
      }

      // ── Download helper (shared by button + modal) ───────────────
      function _triggerDownload(sanitize) {
        var href;
        var label;
        if (_selectedSource && _sources) {
          var fileIdx = 0;
          var containerIdx = 0;
          for (var i = 0; i < _sources.length; i++) {
            if (_sources[i].name === _selectedSource) {
              if (_sources[i].type === 'container') {
                href = _urlPath + '/download?container=' + containerIdx;
                label = 'Downloading container logs…';
              } else {
                href = _urlPath + '/download?file=' + fileIdx;
                label = 'Downloading file…';
              }
              break;
            }
            if (_sources[i].type === 'container') containerIdx++;
            else fileIdx++;
          }
        }
        if (!href) {
          href = _urlPath + '/download?file=' + _currentFileIndex;
          label = 'Downloading file…';
        }
        if (sanitize) {
          href += '&sanitize=1';
          label = 'Downloading sanitized (colors stripped)…';
        }
        var a = document.createElement('a');
        a.href = href;
        a.setAttribute('download', '');
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        setTimeout(function() { document.body.removeChild(a); }, 200);
        _showToast(label);
      }

      if (_elDownloadBtn) {
        _elDownloadBtn.addEventListener('click', function(e) {
          e.preventDefault();
          _triggerDownload();
        });
      }

      if (_elDownloadSanitizedBtn) {
        _elDownloadSanitizedBtn.addEventListener('click', function(e) {
          e.preventDefault();
          _triggerDownload(true);
        });
      }

      // ── Read from start button ───────────────────────────────────
      function _openModal(size) {
        if (_elModalSize) _elModalSize.textContent = 'File size: ' + _formatBytes(size);
        if (_elModalOverlay) _elModalOverlay.classList.remove('hidden');
      }
      function _closeModal() {
        if (_elModalOverlay) _elModalOverlay.classList.add('hidden');
      }
      if (_elModalCancel)  _elModalCancel.addEventListener('click',  _closeModal);
      if (_elModalOverlay) {
        _elModalOverlay.addEventListener('click', function(e) {
          if (e.target === _elModalOverlay) _closeModal();
        });
      }
      if (_elModalDownload) {
        _elModalDownload.addEventListener('click', function() {
          _closeModal();
          _triggerDownload();
        });
      }
      if (_elModalLoadAnyway) {
        _elModalLoadAnyway.addEventListener('click', function() {
          _closeModal();
          _socket.emit('read-from-start', { fileIndex: _currentFileIndex, force: true });
          _showToast('Loading full file… this may take a moment');
        });
      }

      if (_elReadFromStartBtn) {
        _elReadFromStartBtn.addEventListener('click', function() {
          _socket.emit('read-from-start', { fileIndex: _currentFileIndex });
          _showToast('Requesting ' + (_isContainer ? 'logs' : 'file') + ' from beginning…');
        });
      }

      // Sidebar collapse
      if (_elSidebarCollapse) {
        _elSidebarCollapse.addEventListener('click', function() { _setSidebarCollapsed(true); });
      }
      if (_elExpandSidebar) {
        _elExpandSidebar.addEventListener('click', function() { _setSidebarCollapsed(false); });
      }

      // Theme switcher
      var themePills = document.querySelectorAll('.theme-pill');

      function _applyTheme(theme, persist) {
        document.documentElement.setAttribute('data-theme', theme);
        for (var j = 0; j < themePills.length; j++) {
          themePills[j].classList.toggle('active', themePills[j].getAttribute('data-theme') === theme);
        }
        if (persist) _saveSettings({ theme });
      }

      for (var ti = 0; ti < themePills.length; ti++) {
        themePills[ti].addEventListener('click', function() {
          var theme = this.getAttribute('data-theme');
          _applyTheme(theme, true);
          _showToast('Theme: ' + theme);
        });
      }

      // FAB
      if (_elFabScroll) {
        _elFabScroll.addEventListener('click', function() {
          _scrollToBottom();
          _fabNewLines = 0;
          _updateFab();
        });
      }

      // Update-available banner
      if (_elUpdateRefreshBtn) {
        _elUpdateRefreshBtn.addEventListener('click', function() { window.location.reload(); });
      }
      if (_elUpdateDismissBtn) {
        _elUpdateDismissBtn.addEventListener('click', function() {
          _updateBannerDismissed = true;
          if (_elUpdateBanner) _elUpdateBanner.classList.add('hidden');
        });
      }

      // Scroll detection
      if (_elLogViewport) {
        _elLogViewport.addEventListener('scroll', _debounce(_checkScrollPosition, 50), { passive: true });
      }

      // Window focus
      window.addEventListener('blur',  function() { _isWindowFocused = false; }, true);
      window.addEventListener('focus', function() { _isWindowFocused = true; _faviconReset(); }, true);

      // Keyboard shortcuts
      document.addEventListener('keydown', function(e) {
        var activeTag = document.activeElement && document.activeElement.tagName;
        var inInput = activeTag === 'INPUT' || activeTag === 'TEXTAREA';
        if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
          e.preventDefault();
          if (_filterInput) _filterInput.focus();
        }
        if (e.key === ' ' && !inInput) {
          e.preventDefault();
          _setPauseState(!_isPaused);
          _showToast(_isPaused ? 'Paused' : 'Resumed');
        }
        if (e.key === 'Escape' && inInput) {
          if (_filterInput) { _filterInput.value = ''; }
          _filterValue = '';
          if (_elFilterClear) _elFilterClear.classList.add('hidden');
          _setFilterParam('');
          _filterAllLogs();
        }
        if (e.key === 'G' && e.shiftKey && !inInput) {
          _scrollToBottom();
        }
      });

      // Socket
      _socket = opts.socket;
      _socket
        .on('connect',       function() { _setConnStatus('connected',    'Connected'); })
        .on('disconnect',    function() { _setConnStatus('disconnected', 'Disconnected'); })
        .on('connect_error', function() { _setConnStatus('disconnected', 'Connection error'); })
        .on('reconnecting',  function() { _setConnStatus('connecting',   'Reconnecting…'); })
        .on('options:lines', function(limit) { _linesLimit = limit; })
        .on('options:version', function(v) { _checkDeployedVersion(v); })
        .on('options:source-info', function(info) {
          _isContainer = !!(info && info.isContainer);
        })
        .on('options:sources', function(sources) {
          _sources = sources;
          _buildSourceSelector(sources);
          _updateAnsiIndicator();
          _updateTopbarSourceInfo();
        })
        .on('options:hide-topbar', function() {
          if (_topbar) _topbar.classList.add('hide');
          if (_body) _body.classList.add('no-topbar');
        })
        .on('options:no-indent', function() {
          if (_logContainer) _logContainer.classList.add('no-indent');
        })
        .on('options:no-colors', function() {
          _colorsServerDefault = false;
          if (_loadSettings().colors === undefined) {
            _colorsEnabled = false;
            if (_elColorsBtn) _elColorsBtn.classList.remove('active');
          }
        })
        .on('options:highlightConfig', function(cfg) { _highlightConfig = cfg; })
        .on('options:colorsPreset', function(rules) {
          if (Array.isArray(rules)) {
            _userFormatRules = rules.map(_compileUserFormatRule).filter(Boolean);
          }
        })
        .on('file-start-info', function(data) {
          if (data.tooLarge) {
            _openModal(data.size);
          } else {
            // Clear existing log and stream from start
            if (_logContainer) _logContainer.innerHTML = '';
            _totalLines = 0; _visibleLines = 0; _errorCount = 0; _warnCount = 0; _lineNumber = 0;
            _updateStats();
            _showToast('Streaming from ' + (data.isContainer ? 'container' : 'file') + ' beginning…');
          }
        })
        .on('read-end', function() {
          _showToast('Finished loading historical ' + (_isContainer ? 'logs' : 'file'));
        })
        .on('line', function(line) {
          if (_isPaused) {
            _skipCounter++;
            if (_elSkippedBadge) _elSkippedBadge.classList.remove('hidden');
            if (_elSkippedCount) _elSkippedCount.textContent = _skipCounter;
          } else {
            var text = typeof line === 'string' ? line : line.t;
            var source = typeof line === 'string' ? null : line.s;
            self.log(text, source);
          }
        });

      // Prime AudioContext on first click so autoplay policy is satisfied
      document.addEventListener('click', function _primeAudio() {
        _getAudioCtx();
        document.removeEventListener('click', _primeAudio);
      }, { once: true });

      _setConnStatus('connecting', 'Connecting…');

      // ── Restore persisted settings ──────────────────────────────
      var _saved = _loadSettings();

      if (_saved.theme) {
        _applyTheme(_saved.theme, false);
      }

      if (_saved.wrap) {
        _wrapEnabled = true;
        if (_logContainer) _logContainer.classList.add('wrap');
        if (_elWrapBtn) _elWrapBtn.classList.add('active');
      }

      if (_saved.timestamps) {
        _timestampEnabled = true;
        if (_elTimestampBtn) _elTimestampBtn.classList.add('active');
      }

      // Colors: explicit per-browser preference wins over the server default
      if (_saved.colors !== undefined) {
        _colorsEnabled = !!_saved.colors;
      } else {
        _colorsEnabled = _colorsServerDefault;
      }
      if (_elColorsBtn) _elColorsBtn.classList.toggle('active', _colorsEnabled);

      // Restore filter from localStorage (URL param takes precedence)
      if (!_filterValue && _saved.filter) {
        _filterValue = _saved.filter;
        if (_filterInput) _filterInput.value = _filterValue;
        if (_elFilterClear) _elFilterClear.classList.toggle('hidden', !_filterValue);
      }

      // Restore filter option toggles
      if (_saved.regexMode) {
        _regexMode = true;
        if (_elRegexMode) _elRegexMode.checked = true;
      }
      if (_saved.caseSensitive) {
        _caseSensitive = true;
        if (_elCaseSensitive) _elCaseSensitive.checked = true;
      }
      if (_saved.invertFilter) {
        _invertFilter = true;
        if (_elInvertFilter) _elInvertFilter.checked = true;
      }

      // Restore keyword highlights
      if (_saved.highlights && Array.isArray(_saved.highlights) && _saved.highlights.length) {
        _userHighlights = _saved.highlights.map(function(h) {
          return { word: h.word, bip: h.bip || 'off' };
        });
        _renderHighlightTags();
      }

      // Restore level quick-filters
      if (_saved.levelFilters && typeof _saved.levelFilters === 'object') {
        ['error', 'warn', 'info', 'debug'].forEach(function(lvl) {
          if (_saved.levelFilters[lvl] !== undefined) _levelFilters[lvl] = !!_saved.levelFilters[lvl];
        });
      }
      _renderLevelChips();

      // Restore saved filter presets
      if (_saved.savedFilters && Array.isArray(_saved.savedFilters)) {
        _savedFilters = _saved.savedFilters;
      }
      _renderSavedFilters();
      _updateTopbarFilterIndicator();
      _updateTopbarSourceInfo();

      // On mobile, sidebar defaults to collapsed; restore preference on desktop
      var _isMobile = window.matchMedia('(max-width: 640px)').matches;
      if (_isMobile) {
        _setSidebarCollapsed(true);
      } else if (_saved.sidebarCollapsed) {
        _setSidebarCollapsed(true);
      }

    },

    log: function log(data, source, replace) {
      if (!_logContainer) return;

      if (_totalLines === 0 && _elEmptyState) {
        _elEmptyState.classList.add('hidden');
      }

      var wasAtBottom = _isAtBottom;

      var div = document.createElement('div');
      div.className = 'log-line';
      div.setAttribute('data-raw', data);
      if (source) div.setAttribute('data-source', source);

      var level = _detectLevel(data);
      if (level) div.classList.add('level-' + level);

      // Line number
      _lineNumber++;
      var numEl = document.createElement('span');
      numEl.className = 'line-number';
      numEl.textContent = _lineNumber;

      // Timestamp
      var tsEl = document.createElement('span');
      tsEl.className = 'line-timestamp' + (_timestampEnabled ? '' : ' hidden');
      tsEl.textContent = _formatTimestamp();

      // Content
      var contentEl = document.createElement('div');
      contentEl.className = 'line-content';
      var p = document.createElement('p');

      var colorized = _colorizeLine(data);
      var {html} = colorized;
      html = _applyServerHighlightWord(html);
      html = _applyUserHighlights(html);
      if (_filterValue) html = _applyFilterHighlight(html);
      p.innerHTML = html;

      if (colorized.hasAnsi && source && !_ansiSources[source]) {
        _onAnsiDetected(source);
      }

      // Bip check — only for live incoming lines, not replayed from start
      if (!replace) _checkBip(data);

      contentEl.appendChild(p);
      div.appendChild(numEl);
      div.appendChild(tsEl);
      div.appendChild(contentEl);
      div = _applyServerHighlightLine(data, div);

      div.addEventListener('click', function() { this.classList.toggle('selected'); });

      // Stats
      _totalLines++;
      if (level === 'error') _errorCount++;
      if (level === 'warn')  _warnCount++;

      var visible = _lineIsVisible(data, source);
      if (!visible) div.classList.add('filtered-out');
      else          _visibleLines++;

      _updateStats();

      if (replace && _logContainer.lastChild) {
        _logContainer.replaceChild(div, _logContainer.lastChild);
      } else {
        _logContainer.appendChild(div);
      }

      // Trim to limit
      if (_logContainer.children.length > _linesLimit) {
        var removed = _logContainer.children[0];
        var rRaw    = removed.getAttribute('data-raw') || '';
        var rLevel  = _detectLevel(rRaw);
        if (rLevel === 'error' && _errorCount > 0) _errorCount--;
        if (rLevel === 'warn'  && _warnCount  > 0) _warnCount--;
        if (_totalLines > 0) _totalLines--;
        if (!removed.classList.contains('filtered-out') && _visibleLines > 0) _visibleLines--;
        _logContainer.removeChild(removed);
        _updateStats();
      }

      if (wasAtBottom) {
        _scrollToBottom();
        _isAtBottom = true;
      } else {
        _fabNewLines++;
        _updateFab();
        if (_elFabScroll) _elFabScroll.classList.add('visible');
      }

      _updateFaviconCounter();
    }

  };

}(window, document));
