/* global Tinycon:false, ansi_up:false */
/* eslint-disable */

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
  var _fabNewLines     = 0;
  var _userHighlights  = [];

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
      var merged  = Object.assign({}, current, patch);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
    } catch(e) {}
  }

  // DOM refs
  var _elTotalLines, _elVisibleLines, _elErrorCount, _elWarnCount;
  var _elFilterClear, _elRegexMode, _elCaseSensitive, _elInvertFilter;
  var _elHighlightInput, _elHighlightAdd, _elHighlightList;
  var _elPauseLabel, _elPauseIcon;
  var _elClearBtn, _elWrapBtn, _elTimestampBtn;
  var _elConnDot, _elConnText;
  var _elLiveIndicator;
  var _elSkippedBadge, _elSkippedCount;
  var _elEmptyState;
  var _elFabScroll, _elFabCount;
  var _elLogViewport;
  var _elSidebarCollapse, _elExpandSidebar;
  var _toastContainer;

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

  function _filterElement(el) {
    var text = el.getAttribute('data-raw') || el.textContent;
    if (_lineMatchesFilter(text)) {
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
    if (_isAtBottom) _scrollToBottom();
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
    if (sidebar) sidebar.classList.toggle('collapsed', collapsed);
    if (_elExpandSidebar) _elExpandSidebar.classList.toggle('hidden', !collapsed);
    _saveSettings({ sidebarCollapsed: collapsed });
  }

  // ── Highlight tag UI ───────────────────────────────────────────

  function _renderHighlightTags() {
    if (!_elHighlightList) return;
    _elHighlightList.innerHTML = '';
    _userHighlights.forEach(function(h, idx) {
      var color = _highlightAccentColors[idx % _highlightAccentColors.length];
      var tag = document.createElement('div');
      tag.className = 'highlight-tag';
      tag.style.borderLeftColor = color;
      tag.innerHTML =
        '<span>' + _escapeHtml(h.word) + '</span>' +
        '<button class="remove-tag" data-idx="' + idx + '" aria-label="Remove highlight">' +
        '<svg width="10" height="10" viewBox="0 0 10 10" fill="none">' +
        '<path d="M1.5 1.5l7 7M8.5 1.5l-7 7" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>' +
        '</svg></button>';
      tag.querySelector('.remove-tag').addEventListener('click', function(e) {
        var i = parseInt(e.currentTarget.getAttribute('data-idx'), 10);
        _userHighlights.splice(i, 1);
        _renderHighlightTags();
        _reHighlightAll();
      });
      _elHighlightList.appendChild(tag);
    });
  }

  function _addHighlight(word) {
    word = (word || '').trim();
    if (!word) return;
    for (var i = 0; i < _userHighlights.length; i++) {
      if (_userHighlights[i].word.toLowerCase() === word.toLowerCase()) {
        _showToast('Already highlighting: ' + word);
        return;
      }
    }
    _userHighlights.push({ word: word });
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
      var html = ansi_up.escape_for_html(raw);
      html = ansi_up.ansi_to_html(html);
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
      _elHighlightInput = document.getElementById('highlightInput');
      _elHighlightAdd  = document.getElementById('highlightAdd');
      _elHighlightList = document.getElementById('highlightList');
      _elPauseLabel    = document.getElementById('pauseLabel');
      _elPauseIcon     = document.getElementById('pauseIcon');
      _elClearBtn      = document.getElementById('clearBtn');
      _elWrapBtn       = document.getElementById('wrapBtn');
      _elTimestampBtn  = document.getElementById('timestampBtn');
      _elConnDot       = document.getElementById('connDot');
      _elConnText      = document.getElementById('connText');
      _elLiveIndicator = document.getElementById('liveIndicator');
      _elSkippedBadge  = document.getElementById('skippedBadge');
      _elSkippedCount  = document.getElementById('skippedCount');
      _elEmptyState    = document.getElementById('emptyState');
      _elFabScroll     = document.getElementById('fabScroll');
      _elFabCount      = document.getElementById('fabCount');
      _elLogViewport   = document.getElementById('logViewport');
      _elSidebarCollapse = document.getElementById('sidebarCollapse');
      _elExpandSidebar = document.getElementById('expandSidebar');
      _toastContainer  = document.getElementById('toastContainer');
      var _elReadFromStartBtn = document.getElementById('readFromStartBtn');
      var _elDownloadBtn      = document.getElementById('downloadBtn');
      var _elModalOverlay     = document.getElementById('modalOverlay');
      var _elModalBody        = document.getElementById('modalBody');
      var _elModalSize        = document.getElementById('modalSize');
      var _elModalCancel      = document.getElementById('modalCancel');
      var _elModalDownload    = document.getElementById('modalDownload');
      var _elModalLoadAnyway  = document.getElementById('modalLoadAnyway');
      var _currentFileIndex   = 0;   // which file in multi-file mode
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
          _filterAllLogs();
          _reHighlightAll();
        });
      }

      if (_elRegexMode) {
        _elRegexMode.addEventListener('change', function() { _regexMode = this.checked; _filterAllLogs(); });
      }
      if (_elCaseSensitive) {
        _elCaseSensitive.addEventListener('change', function() { _caseSensitive = this.checked; _filterAllLogs(); });
      }
      if (_elInvertFilter) {
        _elInvertFilter.addEventListener('change', function() { _invertFilter = this.checked; _filterAllLogs(); });
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
          _totalLines = _visibleLines = _errorCount = _warnCount = _lineNumber = 0;
          _updateStats();
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

      // ── Download helper (shared by button + modal) ───────────────
      function _triggerDownload() {
        var href = _urlPath + '/download?file=' + _currentFileIndex;
        var a = document.createElement('a');
        a.href = href;
        a.setAttribute('download', '');
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        setTimeout(function() { document.body.removeChild(a); }, 200);
        _showToast('Downloading file…');
      }

      if (_elDownloadBtn) {
        _elDownloadBtn.addEventListener('click', function(e) {
          e.preventDefault();
          _triggerDownload();
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
          _showToast('Requesting file from beginning…');
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
        if (persist) _saveSettings({ theme: theme });
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

      // Scroll detection
      if (_elLogViewport) {
        _elLogViewport.addEventListener('scroll', _debounce(_checkScrollPosition, 50), { passive: true });
      }

      // Window focus
      window.addEventListener('blur',  function() { _isWindowFocused = false; }, true);
      window.addEventListener('focus', function() { _isWindowFocused = true; _faviconReset(); }, true);

      // Keyboard shortcuts
      document.addEventListener('keydown', function(e) {
        var inInput = document.activeElement === _filterInput ||
                      document.activeElement === _elHighlightInput;
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
        .on('options:hide-topbar', function() {
          if (_topbar) _topbar.classList.add('hide');
          if (_body) _body.classList.add('no-topbar');
        })
        .on('options:no-indent', function() {
          if (_logContainer) _logContainer.classList.add('no-indent');
        })
        .on('options:highlightConfig', function(cfg) { _highlightConfig = cfg; })
        .on('file-start-info', function(data) {
          if (data.tooLarge) {
            _openModal(data.size);
          } else {
            // Clear existing log and stream from start
            if (_logContainer) _logContainer.innerHTML = '';
            _totalLines = _visibleLines = _errorCount = _warnCount = _lineNumber = 0;
            _updateStats();
            _showToast('Streaming from file beginning…');
          }
        })
        .on('line', function(line) {
          if (_isPaused) {
            _skipCounter++;
            if (_elSkippedBadge) _elSkippedBadge.classList.remove('hidden');
            if (_elSkippedCount) _elSkippedCount.textContent = _skipCounter;
          } else {
            self.log(line);
          }
        });

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

      // Restore filter from localStorage (URL param takes precedence)
      if (!_filterValue && _saved.filter) {
        _filterValue = _saved.filter;
        if (_filterInput) _filterInput.value = _filterValue;
        if (_elFilterClear) _elFilterClear.classList.toggle('hidden', !_filterValue);
      }

      // On mobile, sidebar defaults to collapsed; restore preference on desktop
      var _isMobile = window.matchMedia('(max-width: 640px)').matches;
      if (_isMobile) {
        _setSidebarCollapsed(true);
      } else if (_saved.sidebarCollapsed) {
        _setSidebarCollapsed(true);
      }

    },

    log: function log(data, replace) {
      if (!_logContainer) return;

      if (_totalLines === 0 && _elEmptyState) {
        _elEmptyState.classList.add('hidden');
      }

      var wasAtBottom = _isAtBottom;

      var div = document.createElement('div');
      div.className = 'log-line';
      div.setAttribute('data-raw', data);

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

      var html = ansi_up.escape_for_html(data);
      html = ansi_up.ansi_to_html(html);
      html = _applyServerHighlightWord(html);
      html = _applyUserHighlights(html);
      if (_filterValue) html = _applyFilterHighlight(html);
      p.innerHTML = html;

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

      var visible = _lineMatchesFilter(data);
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
