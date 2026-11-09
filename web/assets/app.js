/* global Tinycon:false, ansi_up:false, FrontailFormats:false, FrontailUtil:false, FrontailSettings:false, FrontailFilters:false, FrontailHighlight:false */

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
  // Never Infinity: an unbounded container is what froze the tab on Start.
  var DEFAULT_LINES_LIMIT = 5000;
  // Word wrap makes every row taller, so the browser re-measures the whole
  // container: with thousands of rows that is what froze the tab. While wrap is
  // on the window is kept small.
  // Incremented on every read request so a slow previous read cannot keep
  // appending rows after the user asked for something else.
  var _readSeq = 0;
  // True while a "Start" read is replaying a file (or every switched-on
  // file). Rows that cannot fit the visible window are kept as data during
  // that replay; live tailing below still replaces the oldest row normally.
  var _replayingLog = false;
  // Only one read may be in flight: a second click aborts the first one
  // and starts its own slice once the server confirms the abort.
  var _linesLimit      = DEFAULT_LINES_LIMIT;
  // Rows the document is allowed to hold. Older rows live in _olderLines as
  // detached nodes: they cost no layout until the reader scrolls back to them.
  var DOM_LINE_LIMIT   = 100000;
  var _olderLines      = [];
  // The server announces its own --lines budget on connect. Remembering it
  // separately keeps that announcement from silently overriding the smaller
  // window that word wrap requires.
  var _serverLinesLimit = DEFAULT_LINES_LIMIT;
  // How many rows the live view keeps. The server announces its own --lines
  // budget, but the operator can ask for a smaller window in Settings.
  var _bufferLimit = DEFAULT_LINES_LIMIT;

  function _refreshLineLimit() {
    var budget = Math.min(_serverLinesLimit, _bufferLimit) || _bufferLimit || _serverLinesLimit;
    _linesLimit = budget;
    return _linesLimit;
  }
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

  // ── LocalStorage persistence (settings.js) ─────────────────────
  var _settings = FrontailSettings.create(function() { return window.localStorage; });
  var _loadSettings = _settings.load;
  var _saveSettings = _settings.save;

  // ── Localization ────────────────────────────────────────────────────────
  // i18n.js publishes window.FrontailI18n; the markup carries data-i18n,
  // data-i18n-aria and data-i18n-title attributes that applyToDOM() fills in.
  var _i18n = (typeof window !== 'undefined' && window.FrontailI18n) || null;
  var _uiPrefs = _loadSettings() || {};

  function _t(key, params) {
    return _i18n ? _i18n.t(key, params) : key;
  }

  function _currentLanguage() {
    var lang = _uiPrefs.language;
    return (lang === 'ru' || lang === 'en') ? lang : 'auto';
  }

  function _applyLanguage(mode) {
    var next = (mode === 'ru' || mode === 'en') ? mode : 'auto';
    _uiPrefs.language = next;
    if (!_i18n) return;
    _i18n.setLanguage(next);
    _i18n.applyToDOM();
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

  // ── Log directories state ────────────────────────────────────────────
  var _logDirs = []; // array of { dir, name, files: [{ path, name, fileIndex }] }
  var _hiddenLogFiles = []; // array of fileIndex numbers (committed)
  // Checkbox edits land here first: the sidebar is repainted only when the
  // settings dialog is saved, so the dialog needs its own scratch copy.
  var _hiddenDraft = null;
  function _hiddenNow() { return _hiddenDraft || _hiddenLogFiles; }
  var _collapsedLogDirs = []; // array of dir keys the user collapsed

  // ── Utilities ─────────────────────────────────────────────────

  // Pure helpers live in util.js
  var _debounce = FrontailUtil.debounce;
  var _escapeRegExp = FrontailUtil.escapeRegExp;
  var _escapeHtml = FrontailUtil.escapeHtml;
  var _basename = FrontailUtil.basename;

  var FILE_ICON_SVG = '<svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M2.5 1h4.5l2.5 2.5V10a1 1 0 01-1 1h-6a1 1 0 01-1-1V2a1 1 0 011-1z" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round"/><path d="M7 1v2.5h2.5" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round"/></svg>';
  var CONTAINER_ICON_SVG = '<svg width="11" height="11" viewBox="0 0 12 12" fill="none"><rect x="1.5" y="0.5" width="9" height="7" rx="1.5" stroke="currentColor" stroke-width="1.1"/><rect x="3.5" y="2" width="5" height="4" rx="0.8" stroke="currentColor" stroke-width="0.8"/><circle cx="6" cy="9.5" r="1.2" stroke="currentColor" stroke-width="0.9"/></svg>';
  var LAYERS_ICON_SVG = '<svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M6 1l5 2.5L6 6 1 3.5 6 1z" stroke="currentColor" stroke-width="1" stroke-linejoin="round"/><path d="M1 6l5 2.5L11 6" stroke="currentColor" stroke-width="1" stroke-linejoin="round"/><path d="M1 8.5l5 2.5 5-2.5" stroke="currentColor" stroke-width="1" stroke-linejoin="round"/></svg>';

  var _toastMap = {};
function _removeToast(el) {
  if (!el) return;
  el.style.opacity = '0';
  el.style.transition = 'opacity 0.3s';
  setTimeout(function() {
    if (el.parentNode) el.parentNode.removeChild(el);
    if (el._toastMsg) delete _toastMap[el._toastMsg];
  }, 300);
}
function _showToast(msg, duration) {
  if (!_toastContainer) return;
  // If a toast with same message exists, reset its timer
  var existing = _toastMap[msg];
  if (existing) {
    clearTimeout(existing.timeout);
    existing.timeout = setTimeout(function(){ _removeToast(existing.el); }, duration || 2000);
    return;
  }
  var el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  el._toastMsg = msg;
  // click to dismiss immediately
  el.addEventListener('click', function(){
    clearTimeout(el._toastTimeout);
    _removeToast(el);
  });
  // Ensure pointer events
  el.style.cursor = 'pointer';
  _toastContainer.appendChild(el);
  // Trim the oldest toasts. _removeToast() only fades a toast out and drops the
  // node 300 ms later, so calling it here never shrinks the list: the loop kept
  // reading the same firstChild and the page froze as soon as a fourth toast
  // arrived. Detach the node immediately instead.
  while (_toastContainer.children.length > 3) {
    var old = _toastContainer.firstChild;
    if (!old) break;
    clearTimeout(old._toastTimeout);
    if (old._toastMsg) delete _toastMap[old._toastMsg];
    _toastContainer.removeChild(old);
  }
  var timeout = setTimeout(function() {
    _removeToast(el);
  }, duration || 2000);
  el._toastTimeout = timeout;
  _toastMap[msg] = { el: el, timeout: timeout };
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

  var _formatBytes = FrontailUtil.formatBytes;

  // ── Stats ──────────────────────────────────────────────────────

  function _updateStats() {
    if (_elTotalLines)   _elTotalLines.textContent   = _totalLines;
    if (_elVisibleLines) _elVisibleLines.textContent = _visibleLines;
    if (_elErrorCount)   _elErrorCount.textContent   = _errorCount;
    if (_elWarnCount)    _elWarnCount.textContent     = _warnCount;
  }

  // ── Log format detection & colorizing ─────────────────────────
  // Lives in formats.js (loaded before this file).
  var _detectLevel       = FrontailFormats.detectLevel;
  var _hasAnsiCodes      = FrontailFormats.hasAnsiCodes;
  var _tryColorizeJson   = FrontailFormats.tryColorizeJson;
  var _applyFormatColors = FrontailFormats.applyFormatColors;

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

  // The logic lives in filters.js; this snapshots the current UI state.
  function _filterState() {
    return {
      filterValue: _filterValue,
      regexMode: _regexMode,
      caseSensitive: _caseSensitive,
      invertFilter: _invertFilter,
      selectedSource: _selectedSource,
      levelFilters: _levelFilters
    };
  }

  function _lineIsVisible(text, source) {
    return FrontailFilters.isVisible(text, source, _filterState());
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
    var allOn = !!(_levelFilters.error && _levelFilters.warn
      && _levelFilters.info && _levelFilters.debug);
    for (var i = 0; i < chips.length; i++) {
      var lvl = chips[i].getAttribute('data-level');
      if (lvl === 'all') {
        chips[i].classList.toggle('active', allOn);
        continue;
      }
      chips[i].classList.toggle('active', !!_levelFilters[lvl]);
    }
  }

  function _toggleLevelFilter(level) {
    if (level === 'all') {
      // "All" is the unfiltered view: every level back on, so lines without a
      // recognised level are visible again.
      _levelFilters = { error: true, warn: true, info: true, debug: true };
      _saveSettings({ levelFilters: _levelFilters });
      _renderLevelChips();
      _filterAllLogs();
      return;
    }
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
    _showToast(_t('ui.toast.filterApplied', { name: f.name }));
  }

  function _saveCurrentFilter(name) {
    name = (name || '').trim();
    if (!name) return;
    if (!_filterValue) { _showToast(_t('ui.toast.filterTypeFirst')); return; }
    var entry = {
      name, value: _filterValue, regexMode: _regexMode,
      caseSensitive: _caseSensitive, invertFilter: _invertFilter
    };
    for (var i = 0; i < _savedFilters.length; i++) {
      if (_savedFilters[i].name.toLowerCase() === name.toLowerCase()) {
        _savedFilters[i] = entry;
        _saveSettings({ savedFilters: _savedFilters });
        _renderSavedFilters();
        _showToast(_t('ui.toast.filterUpdated', { name: name }));
        return;
      }
    }
    _savedFilters.push(entry);
    _saveSettings({ savedFilters: _savedFilters });
    _renderSavedFilters();
    if (_elSavedFilterName) _elSavedFilterName.value = '';
    _showToast(_t('ui.toast.filterSaved', { name: name }));
  }

  // ── Export currently visible lines ──────────────────────────────

  function _downloadFilteredView() {
    if (!_logContainer) return;
    var lines = _logContainer.querySelectorAll('.log-line:not(.filtered-out)');
    if (!lines.length) { _showToast(_t('ui.toast.nothingToDownload')); return; }
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
    _showToast(_t('ui.toast.downloadedLines', { count: lines.length }));
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

  // The highlighting logic lives in highlight.js and filters.js.
  function _applyServerHighlightWord(line) {
    return FrontailHighlight.applyServerWords(line, _highlightConfig);
  }

  function _applyServerHighlightLine(text, container) {
    return FrontailHighlight.applyServerLine(text, container, _highlightConfig);
  }

  // ── Highlight: user keywords ───────────────────────────────────

  function _applyUserHighlights(html) {
    return FrontailHighlight.applyKeywords(html, _userHighlights, _highlightCssClasses);
  }

  function _applyFilterHighlight(html) {
    return FrontailFilters.highlightMatches(html, _filterState());
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
    _showToast(_t('ui.toast.ansiSkipped', { source: source || 'Source' }));
  }

  // ── Scroll ─────────────────────────────────────────────────────

  function _checkScrollPosition() {
    var vp = _elLogViewport;
    if (!vp) return;
    _isAtBottom = vp.scrollHeight - vp.scrollTop - vp.clientHeight < 60;
    if (_isAtBottom) { _fabNewLines = 0; _updateFab(); }
    if (_elFabScroll) _elFabScroll.classList.toggle('visible', !_isAtBottom);
  }

  function _scrollToBottom(opts) {
    if (!_elLogViewport) return;
    _elLogViewport.scrollTop = _elLogViewport.scrollHeight;
    // An explicit request to see the tail (FAB, Shift+G) is a reader saying
    // "I am back": the automatic pause drops and the lines it held back are
    // poured in. Setting scrollTop alone would not, since the scroll event
    // handler bails out while a replay is running.
    if (opts && opts.resume && _autoPaused) {
      _autoPaused = false;
      _flushLiveBuffer();
    }
  }

  function _updateFab() {
    if (!_elFabCount) return;
    _elFabCount.textContent = _fabNewLines > 0 ? '+' + _fabNewLines : '';
  }

  // ── Sidebar ────────────────────────────────────────────────────

  // `remember` is false while restoring the saved state at start-up: the
  // classes still have to be applied, otherwise the expand button stays
  // visible next to the open sidebar.
  function _setSidebarCollapsed(collapsed, remember) {
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
    if (remember !== false) _saveSettings({ sidebarCollapsed: collapsed });
  }

  // ── Sidebar resizer ────────────────────────────────────────────
  // The sidebar is not nailed to a fixed width any more: dragging the handle
  // between the sidebar and the log area sets --sidebar-width, and the value
  // is remembered in the same settings object as the rest of the prefs.

  var SIDEBAR_DEFAULT_WIDTH = 290;
  var SIDEBAR_MIN_WIDTH = 180;
  var SIDEBAR_MAX_RATIO = 0.6;

  function _sidebarMaxWidth() {
    return Math.max(SIDEBAR_MIN_WIDTH, Math.round(window.innerWidth * SIDEBAR_MAX_RATIO));
  }

  function _applySidebarWidth(px) {
    var width = Math.round(Number(px) || 0);
    if (width < SIDEBAR_MIN_WIDTH) width = SIDEBAR_MIN_WIDTH;
    var max = _sidebarMaxWidth();
    if (width > max) width = max;
    document.documentElement.style.setProperty('--sidebar-width', width + 'px');
    return width;
  }

  function _currentSidebarWidth() {
    var sidebar = document.getElementById('sidebar');
    if (!sidebar) return SIDEBAR_DEFAULT_WIDTH;
    var width = sidebar.getBoundingClientRect().width;
    return width > 0 ? Math.round(width) : SIDEBAR_DEFAULT_WIDTH;
  }

  // The width used to be pinned to 240px. Browsers that remember that value
  // would keep the old default forever, so a stored 240 is treated as "never
  // chosen by hand" and replaced once by the current default.
  var SIDEBAR_LEGACY_WIDTH = 240;

  function _loadSidebarWidth() {
    var saved = _loadSettings() || {};
    if (typeof saved.sidebarWidth !== 'number' || saved.sidebarWidth <= 0) return;
    if (saved.sidebarWidth === SIDEBAR_LEGACY_WIDTH) {
      _applySidebarWidth(SIDEBAR_DEFAULT_WIDTH);
      _saveSettings({ sidebarWidth: SIDEBAR_DEFAULT_WIDTH });
      return;
    }
    _applySidebarWidth(saved.sidebarWidth);
  }

  function _initSidebarResizer() {
    var resizer = document.getElementById('sidebarResizer');
    var sidebar = document.getElementById('sidebar');
    var app = document.getElementById('app');
    if (!resizer || !sidebar || !app) return;

    var dragging = false;
    // The sidebar animates its width, so measuring it the moment the pointer is
    // released returns the value from before the animation - store what the drag
    // actually applied instead.
    var appliedWidth = 0;

    function stopDragging() {
      if (!dragging) return;
      dragging = false;
      app.classList.remove('resizing');
      resizer.classList.remove('dragging');
      _saveSettings({ sidebarWidth: appliedWidth || _currentSidebarWidth() });
    }

    function onPointerDown(e) {
      if (e.button !== undefined && e.button !== 0) return;
      appliedWidth = _currentSidebarWidth();
      dragging = true;
      app.classList.add('resizing');
      resizer.classList.add('dragging');
      if (resizer.setPointerCapture && e.pointerId !== undefined) {
        try { resizer.setPointerCapture(e.pointerId); } catch { /* capture is best-effort */ }
      }
      e.preventDefault();
    }

    function onPointerMove(e) {
      if (!dragging) return;
      appliedWidth = _applySidebarWidth(e.clientX);
      e.preventDefault();
    }

    resizer.addEventListener('pointerdown', onPointerDown);
    resizer.addEventListener('pointermove', onPointerMove);
    resizer.addEventListener('pointerup', stopDragging);
    resizer.addEventListener('pointercancel', stopDragging);
    resizer.addEventListener('lostpointercapture', stopDragging);

    // Double click restores the default width.
    resizer.addEventListener('dblclick', function() {
      _applySidebarWidth(SIDEBAR_DEFAULT_WIDTH);
      _saveSettings({ sidebarWidth: SIDEBAR_DEFAULT_WIDTH });
    });

    // Keyboard: arrows resize by 10px (40px with Shift), Home restores default.
    resizer.addEventListener('keydown', function(e) {
      var step = e.shiftKey ? 40 : 10;
      var width = _currentSidebarWidth();
      if (e.key === 'ArrowLeft') {
        _applySidebarWidth(width - step);
      } else if (e.key === 'ArrowRight') {
        _applySidebarWidth(width + step);
      } else if (e.key === 'Home') {
        _applySidebarWidth(SIDEBAR_DEFAULT_WIDTH);
      } else {
        return;
      }
      _saveSettings({ sidebarWidth: _currentSidebarWidth() });
      e.preventDefault();
    });
  }

  // ── Source selector ─────────────────────────────────────────────


  // ── Source folders ──────────────────────────────────────────────
  // Sources that live under a mounted log directory are grouped the same way
  // the settings tree shows them, so the sidebar reads as folders instead of
  // one long flat run of paths.

  var _collapsedSourceDirs = null;

  function _sourceDirCollapsed() {
    if (_collapsedSourceDirs === null) {
      var st = _loadSettings().collapsedSourceDirs;
      _collapsedSourceDirs = Array.isArray(st) ? st.slice() : [];
    }
    return _collapsedSourceDirs;
  }

  function _toggleSourceDir(name) {
    var list = _sourceDirCollapsed();
    var idx = list.indexOf(name);
    if (idx === -1) { list.push(name); } else { list.splice(idx, 1); }
    _saveSettings({ collapsedSourceDirs: list });
  }

  // The server streams every configured file; a file whose checkbox is off
  // in the settings must not reach the viewer even when "All" is selected.
  function _sourceIndexByName(name) {
    if (!name || !_sources) return -1;
    for (var i = 0; i < _sources.length; i++) {
      if (_sources[i].name === name) return i;
    }
    return -1;
  }

  function _sourceAllowed(name) {
    var idx = _sourceIndexByName(name);
    if (idx < 0) return true;
    return _hiddenNow().indexOf(idx) === -1;
  }

  function _makeSourceChip(s) {
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

    // Hide right here rather than relying on _applySourceVisibility(): a rebuild
    // creates fresh buttons, so any earlier style.display is lost and the panel
    // would show files the operator already unticked.
    var hiddenIndex = _sources.indexOf(s);
    if (hiddenIndex >= 0 && _hiddenLogFiles.indexOf(hiddenIndex) >= 0) {
      chip.style.display = 'none';
    }
    return chip;
  }

  function _makeSourceDirGroup(name, items, totalCount) {
    var collapsed = _sourceDirCollapsed().indexOf(name) !== -1;
    var box = document.createElement('div');
    box.className = 'source-dir-group' + (collapsed ? ' collapsed' : '');
    box.setAttribute('data-dir', name);

    var head = document.createElement('button');
    head.type = 'button';
    head.className = 'source-dir-head';
    head.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    head.innerHTML = '<svg class="source-dir-chevron" width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg><svg class="source-dir-icon" width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M1.5 3.2A1.2 1.2 0 012.7 2h2.1l1.1 1.3h3.4A1.2 1.2 0 0110.5 4.5v4.3A1.2 1.2 0 019.3 10H2.7a1.2 1.2 0 01-1.2-1.2z" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round"/></svg>';

    var label = document.createElement('span');
    label.className = 'source-dir-name';
    label.textContent = name;
    head.appendChild(label);

    var num = document.createElement('span');
    num.className = 'source-dir-count';
    if (typeof totalCount === 'number' && totalCount > items.length) {
      num.innerHTML = '<span class="source-dir-count-on">' + items.length + '</span>' +
        '<span class="source-dir-count-total"> (' + totalCount + ')</span>';
    } else {
      num.textContent = items.length;
    }
    head.appendChild(num);

    head.addEventListener('click', function() {
      _toggleSourceDir(name);
      _buildSourceSelector(_sources);
    });
    box.appendChild(head);

    for (var i = 0; i < items.length; i++) {
      box.appendChild(_makeSourceChip(items[i]));
    }
    return box;
  }

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

    var groupOrder = [];
    var grouped = {};
    for (var d = 0; d < _logDirs.length; d++) {
      var dirName = _logDirs[d].name || _logDirs[d].dir;
      if (!dirName || grouped[dirName]) continue;
      grouped[dirName] = { dir: _logDirs[d].dir || '', items: [] };
      groupOrder.push(dirName);
    }

    var rest = [];
    for (var i = 0; i < sources.length; i++) {
      var s = sources[i];
      var placed = false;
      for (var g = 0; g < groupOrder.length; g++) {
        var base = String(grouped[groupOrder[g]].dir).replace(/\/$/, '');
        if (base && s.name.indexOf(base + '/') === 0) {
          grouped[groupOrder[g]].total = (grouped[groupOrder[g]].total || 0) + 1;
          // Folders whose every file is switched off in the settings leave the
          // sidebar entirely: there is nothing in them to listen to.
          if (_sourceAllowed(s.name)) grouped[groupOrder[g]].items.push(s);
          placed = true;
          break;
        }
      }
      if (!placed && _sourceAllowed(s.name)) rest.push(s);
    }

    for (var gi = 0; gi < groupOrder.length; gi++) {
      var grp = grouped[groupOrder[gi]];
      if (!grp.items.length) continue;
      _elSourceList.appendChild(_makeSourceDirGroup(groupOrder[gi], grp.items, grp.total));
    }

    for (var ri = 0; ri < rest.length; ri++) {
      _elSourceList.appendChild(_makeSourceChip(rest[ri]));
    }

    // With every directory unticked the panel would be blank, so point the
    // operator at the place that brings the files back.
    var _shown = _elSourceList.querySelectorAll('.source-chip[data-source]');
    var _visibleChips = 0;
    for (var vi = 0; vi < _shown.length; vi++) {
      if (_shown[vi].getAttribute('data-source') && _shown[vi].style.display !== 'none') _visibleChips++;
    }
    if (!_visibleChips) {
      var emptyHint = document.createElement('div');
      emptyHint.className = 'source-empty-hint';
      emptyHint.textContent = _t('ui.sidebar.emptySources');
      _elSourceList.appendChild(emptyHint);
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
        _showToast(_t('ui.toast.bipWord') + ': ' + _userHighlights[i].word + ' → ' + next);
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
        _showToast(_t('ui.toast.alreadyHighlighting', { word: word }));
        return;
      }
    }
    _userHighlights.push({ word, bip: bip || 'off' });
    _saveHighlights();
    _renderHighlightTags();
    _reHighlightAll();
    if (_elHighlightInput) _elHighlightInput.value = '';
    _showToast(_t('ui.toast.highlighting', { word: word }));
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
      } catch { return null; }
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

  function _renderLogDirs() {
      var container = document.getElementById('logDirsTree');
      if (!container) return;
      while (container.firstChild) container.removeChild(container.firstChild);

      if (!_logDirs.length) {
        var empty = document.createElement('div');
        empty.className = 'log-dirs-empty';
        empty.textContent = _t('ui.settings.logDirsEmpty');
        container.appendChild(empty);
        return;
      }

      _logDirs.forEach(function(dirEntry) {
        var files = dirEntry.files || [];
        var indexes = files.map(function(f) { return f.fileIndex; });
        var visible = indexes.filter(function(i) { return _hiddenNow().indexOf(i) === -1; });

        var group = document.createElement('div');
        group.className = 'log-dir-group';

        var head = document.createElement('div');
        head.className = 'log-dir-head';
        var dirKey = dirEntry.dir || dirEntry.name || '';
        var isOpen = _collapsedLogDirs.indexOf(dirKey) === -1;

        var dirCheck = document.createElement('input');
        dirCheck.type = 'checkbox';
        dirCheck.className = 'log-dir-check';
        dirCheck.checked = indexes.length > 0 && visible.length === indexes.length;
        dirCheck.indeterminate = visible.length > 0 && visible.length < indexes.length;
        dirCheck.addEventListener('change', function() {
          if (!_hiddenDraft) _hiddenDraft = _hiddenLogFiles.slice();
          if (dirCheck.checked) {
            _hiddenDraft = _hiddenDraft.filter(function(i) { return indexes.indexOf(i) === -1; });
          } else {
            indexes.forEach(function(i) {
              if (_hiddenDraft.indexOf(i) === -1) _hiddenDraft.push(i);
            });
          }
          _renderLogDirs();
        });

        var dirIcon = document.createElement('span');
        dirIcon.className = 'log-dir-icon';
        dirIcon.innerHTML = '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M1.6 4.3c0-.7.6-1.3 1.3-1.3h2.9l1.4 1.7h5.9c.7 0 1.3.6 1.3 1.3v5.6c0 .7-.6 1.3-1.3 1.3H2.9c-.7 0-1.3-.6-1.3-1.3V4.3z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>';
        head.appendChild(dirIcon);

        var title = document.createElement('span');
        title.className = 'log-dir-title';
        title.textContent = dirEntry.name || dirEntry.dir;
        title.title = dirEntry.dir || '';
        head.appendChild(title);

        var count = document.createElement('span');
        count.className = 'log-dir-count';
        count.textContent = visible.length + '/' + indexes.length;
        head.appendChild(count);
        head.appendChild(dirCheck);

        var toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = 'log-dir-toggle' + (isOpen ? '' : ' collapsed');
        toggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
        toggle.textContent = '▾';
        var toggleDir = function() {
          var at = _collapsedLogDirs.indexOf(dirKey);
          if (at === -1) {
            _collapsedLogDirs.push(dirKey);
          } else {
            _collapsedLogDirs.splice(at, 1);
          }
          _saveSettings({ collapsedLogDirs: _collapsedLogDirs });
          _renderLogDirs();
        };
        toggle.addEventListener('click', function(ev) {
          ev.preventDefault();
          ev.stopPropagation();
          toggleDir();
        });
        head.insertBefore(toggle, head.firstChild);

        // Clicking anywhere on the row folds the folder. The checkbox is the
        // only control that switches its files on or off, so a stray click on
        // the folder name no longer wipes the whole directory.
        head.addEventListener('click', function(ev) {
          if (ev.target === dirCheck) return;
          toggleDir();
        });
        group.appendChild(head);

        var list = document.createElement('div');
        list.className = 'log-dir-files';
        list.hidden = !isOpen;

        files.forEach(function(file) {
          var row = document.createElement('label');
          row.className = 'log-dir-file';

          var cb = document.createElement('input');
          cb.type = 'checkbox';
          cb.className = 'log-file-check';
          cb.checked = _hiddenNow().indexOf(file.fileIndex) === -1;
          cb.addEventListener('change', function() {
            if (!_hiddenDraft) _hiddenDraft = _hiddenLogFiles.slice();
            var pos = _hiddenDraft.indexOf(file.fileIndex);
            if (cb.checked) {
              if (pos !== -1) _hiddenDraft.splice(pos, 1);
            } else if (pos === -1) {
              _hiddenDraft.push(file.fileIndex);
            }
            _renderLogDirs();
          });

          var fileIcon = document.createElement('span');
          fileIcon.className = 'log-file-icon';
          fileIcon.innerHTML = '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3.6 1.9h5.1l3.7 3.7v8.5H3.6z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="M8.6 1.9v3.8h3.8" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>';
          row.appendChild(fileIcon);
          row.appendChild(cb);

          var nm = document.createElement('span');
          nm.className = 'log-file-name';
          nm.textContent = file.name || file.path;
          nm.title = file.path || '';
          row.appendChild(nm);
          row.classList.toggle('is-off', !cb.checked);

          list.appendChild(row);
        });

        group.appendChild(list);
        container.appendChild(group);
      });
    }

  // Hides the source chips of files the user unchecked in "Connected directories".
  function _applySourceVisibility() {
    if (!_elSourceList) return;
    var chips = _elSourceList.querySelectorAll('.source-chip[data-source]');
    for (var i = 0; i < chips.length; i++) {
      var name = chips[i].getAttribute('data-source');
      if (!name) continue;
      var index = -1;
      for (var j = 0; j < _sources.length; j++) {
        if (_sources[j].name === name) { index = j; break; }
      }
      var hidden = index >= 0 && _hiddenLogFiles.indexOf(index) >= 0;
      chips[i].style.display = hidden ? 'none' : '';
    }
  }



  // A row that lives outside the document keeps only what is needed to draw it
  // again later: building the node is the expensive part, not holding the text.
  function _detachLine(el) {
    var numEl = el.querySelector('.line-number');
    var tsEl  = el.querySelector('.line-timestamp');
    var level = null;
    for (var i = 0; i < el.classList.length; i++) {
      var cls = el.classList[i];
      if (cls.indexOf('level-') === 0) { level = cls.slice(6); break; }
    }
    return {
      raw: el.getAttribute('data-raw') || '',
      source: el.getAttribute('data-source') || null,
      level: level,
      visible: !el.classList.contains('filtered-out'),
      num: numEl ? numEl.textContent : '',
      ts: tsEl ? tsEl.textContent : ''
    };
  }

  function _buildLineNode(row, plain) {
    var div = document.createElement('div');
    div.className = 'log-line';
    div.setAttribute('data-raw', row.raw);
    if (row.source) div.setAttribute('data-source', row.source);
    if (row.level) div.classList.add('level-' + row.level);

    var numEl = document.createElement('span');
    numEl.className = 'line-number';
    numEl.textContent = row.num;

    var tsEl = document.createElement('span');
    tsEl.className = 'line-timestamp' + (_timestampEnabled ? '' : ' hidden');
    tsEl.textContent = row.ts;

    var contentEl = document.createElement('div');
    contentEl.className = 'line-content';
    var p = document.createElement('p');

    // Bulk rows arrive as plain text: colouring every line up front is the
    // expensive part of a big slice, so only the rows that reach the viewport
    // get their spans built by _paintLine().
    if (plain) {
      p.textContent = row.raw;
    } else {
      var colorized = _colorizeLine(row.raw);
      var html = colorized.html;
      html = _applyServerHighlightWord(html);
      html = _applyUserHighlights(html);
      if (_filterValue) html = _applyFilterHighlight(html);
      p.innerHTML = html;
      div.setAttribute('data-colored', '1');

      if (colorized.hasAnsi && row.source && !_ansiSources[row.source]) {
        _onAnsiDetected(row.source);
      }
    }

    contentEl.appendChild(p);
    div.appendChild(numEl);
    div.appendChild(tsEl);
    div.appendChild(contentEl);
    div = _applyServerHighlightLine(row.raw, div);

    div.addEventListener('click', function() { this.classList.toggle('selected'); });

    if (!row.visible) div.classList.add('filtered-out');
    return div;
  }

  // Paints one row that was inserted as plain text, and reports whether it did.
  function _paintLine(el) {
    if (!el || el.getAttribute('data-colored') === '1') return false;
    var p = el.querySelector('.line-content > p');
    if (!p) return false;
    var raw = el.getAttribute('data-raw') || '';
    var colorized = _colorizeLine(raw);
    var html = colorized.html;
    html = _applyServerHighlightWord(html);
    html = _applyUserHighlights(html);
    if (_filterValue) html = _applyFilterHighlight(html);
    p.innerHTML = html;
    el.setAttribute('data-colored', '1');
    var source = el.getAttribute('data-source');
    if (colorized.hasAnsi && source && !_ansiSources[source]) _onAnsiDetected(source);
    return true;
  }

  // Colours what a reader can actually see, plus a screen worth of margin, so a
  // five-thousand-line slice costs a hundred lines of work instead of five.
  function _paintVisible() {
    if (!_logContainer || !_elLogViewport) return 0;
    var rows = _logContainer.children;
    if (!rows.length) return 0;
    // Rows have not necessarily been laid out yet, so their rectangles can all
    // read as zero. Positions come from the scroll offset and the average row
    // height instead: constant time, and correct for the ordinary case of rows
    // that share a height.
    var avg = _logContainer.scrollHeight / rows.length;
    if (!(avg > 0)) avg = 22;
    var top = _elLogViewport.scrollTop;
    var height = _elLogViewport.clientHeight || 800;
    var first = Math.max(0, Math.floor((top - 200) / avg));
    var last = Math.min(rows.length - 1, Math.ceil((top + height + 200) / avg));
    if (last - first > 60) last = Math.min(rows.length - 1, first + 60);
    var painted = 0;
    for (var i = first; i <= last; i++) {
      if (_paintLine(rows[i])) painted++;
    }
    return painted;
  }

  var _paintScheduled = false;
  var _paintTimer = null;
  // Waiting for the scroll to settle keeps colouring off the frames the reader
  // is actually dragging: painting mid-fling only adds work on top of layout.
  function _schedulePaint() {
    if (_paintScheduled) return;
    _paintScheduled = true;
    if (_paintTimer) window.clearTimeout(_paintTimer);
    _paintTimer = window.setTimeout(function () {
      _paintTimer = null;
      _paintScheduled = false;
      window.requestAnimationFrame(function () {
        _paintVisible();
      });
    }, 140);
  }

  function _flushLiveBuffer() {
    if (!_liveBuffer.length || !_logAppendFn) return;
    var items = _liveBuffer;
    _liveBuffer = [];
    for (var i = 0; i < items.length; i++) _logAppendFn(items[i][0], items[i][1]);
  }

  // Lines arriving in a burst (Start, Start X, reconnect) are painted in small
  // slices so the browser keeps a frame budget instead of freezing.
  // Keeps the log container under the current row limit. Wrap mode re-lays out
  // every row, so shrinking the window is the cheap way out; the counters are
  // corrected for whatever gets dropped.
  function _trimToLimit() {
    if (!_logContainer) return 0;
    var trimmed = 0;
    // Two caps at once: what the document may hold and what the row budget
    // allows in total. A small budget (options:lines) must still evict, even
    // when the document is nowhere near the DOM ceiling.
    // Right after rows were restored above the viewport the ceiling is lifted
    // for a moment, otherwise they are dropped again and the reader is yanked
    // back to the bottom.
    var ceiling = Date.now() < _holdTrimUntil ? DOM_LINE_LIMIT_SOFT : DOM_LINE_LIMIT;
    var keep = Math.min(ceiling, _linesLimit);
    while (_logContainer.children.length > keep) {
      var removed = _logContainer.children[0];
      _olderLines.push(_detachLine(removed));
      _logContainer.removeChild(removed);
      trimmed++;
    }
    // Rows that no longer fit the row budget are dropped for good: keep the
    // newest _linesLimit rows across the window and the detached tail.
    while (_olderLines.length &&
           (_olderLines.length + _logContainer.children.length) > _linesLimit) {
      var dropped = _olderLines.shift();
      if (dropped.level === 'error' && _errorCount > 0) _errorCount--;
      if (dropped.level === 'warn'  && _warnCount  > 0) _warnCount--;
      if (_totalLines > 0) _totalLines--;
      if (dropped.visible && _visibleLines > 0) _visibleLines--;
    }
    if (trimmed) _updateStats();
    return trimmed;
  }

  // Puts older rows back in front of the window, keeping the reading position:
  // the scroll offset grows by exactly the height that was inserted above it.
  function _restoreOlderLines(count) {
    if (!_logContainer || !_olderLines.length) return 0;
    var moved = 0;
    // Rows are prepended, so the reader keeps looking at the same spot only if
    // nothing is compensated: the new rows land right where the pointer is and
    // the old ones slide down with them.
    while (count-- > 0 && _olderLines.length && _logContainer.children.length < DOM_LINE_LIMIT_SOFT) {
      var el = _buildLineNode(_olderLines.pop(), true);
      _logContainer.insertBefore(el, _logContainer.firstChild);
      moved++;
    }
    return moved;
  }

  // While set, the window may grow past DOM_LINE_LIMIT instead of dropping rows
  // the reader has just scrolled back to.
  var _holdTrimUntil = 0;
  var DOM_LINE_LIMIT_SOFT = 100000;

  var _pendingLogLines   = [];
  var _logFlushScheduled = false;
  var _logAppendFn       = null;
  // While the reader is away from the tail, incoming lines wait in this buffer
  // instead of being appended under their cursor. Scrolling back to the tail
  // pours them in, which is the automatic pause/resume the log needs.
  var _autoPaused = false;
  var _liveBuffer = [];
  var LIVE_BUFFER_LIMIT = 20000;
  // True while a bulk chunk is being appended: per-line scrolling and
  // stat repaints force a layout each time, which is what froze the tab on
  // big logs. They are applied once per chunk instead.
  var _renderBulk        = false;
  // Slice rows are collected here and inserted once: appending row by row
  // re-lays out the container for every line, which is what froze the tab
  // on big logs in wrap mode.
  var _bulkFragment      = null;
  var LOG_FRAME_BUDGET_MS = 12;

  function _now() {
    return (window.performance && window.performance.now)
      ? window.performance.now()
      : Date.now();
  }

  function _scheduleLogFlush() {
    if (_logFlushScheduled) return;
    _logFlushScheduled = true;
    window.requestAnimationFrame(_flushPendingLogLines);
  }

  var _flushingLog = false;

  function _flushPendingLogLines() {
    if (_flushingLog) return;
    _flushingLog = true;
    _logFlushScheduled = false;
    // Bailing out here used to leave the guard raised for good, and every later
    // frame was dropped: the pane went silent and the backlog kept growing.
    if (!_pendingLogLines.length || !_logAppendFn) { _flushingLog = false; return; }
    var started = _now();
    _renderBulk = true;
    _bulkFragment = document.createDocumentFragment();
    try {
      while (_pendingLogLines.length) {
      var item = _pendingLogLines.shift();
      _logAppendFn(item.data, item.source, item.replace);
        if (_now() - started >= LOG_FRAME_BUDGET_MS) break;
      }
    } finally {
      _renderBulk = false;
      if (_bulkFragment) {
        if (_bulkFragment.childNodes.length) _logContainer.appendChild(_bulkFragment);
        _bulkFragment = null;
      }
      _trimToLimit();
    }
    _updateStats();
    if (_isAtBottom) _scrollToBottom();
    _flushingLog = false;
    if (_pendingLogLines.length) _scheduleLogFlush();
  }


  return {

    init: function init(opts) {
      var self = this;
      _logAppendFn = this.log;

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
      // Declared before _startLines is initialised: _loadStartLines() reads the
      // key below, and `var` hoisting does not lift the assignment.
      var START_LINES_KEY = 'frontail.startLines';
      var DEFAULT_START_LINES = 1000;
      var _elReadStartXBtn   = document.getElementById('readStartXBtn');
      var _elStartLinesBtn   = document.getElementById('startLinesBtn');
      var _elReadStartLabel  = document.getElementById('readStartLabel');
      var _startLines        = _loadStartLines();
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

      _applyLanguage(_currentLanguage());
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
          _showToast(_isPaused ? _t('ui.toast.paused') : _t('ui.toast.resumed'));
        });
      }

      // Clear
      if (_elClearBtn) {
        _elClearBtn.addEventListener('click', function() {
          if (!_logContainer) return;
          _logContainer.innerHTML = '';
          _olderLines.length = 0;
          _totalLines = 0; _visibleLines = 0; _errorCount = 0; _warnCount = 0; _lineNumber = 0;
          _updateStats();
          _resetBipFired();
          if (_elEmptyState) _elEmptyState.classList.remove('hidden');
          _showToast(_t('ui.toast.cleared'));
        });
      }

      // Word wrap
      if (_elWrapBtn) {
        _elWrapBtn.addEventListener('click', function() {
          _wrapEnabled = !_wrapEnabled;
          _refreshLineLimit();
          if (_logContainer) _logContainer.classList.toggle('wrap', _wrapEnabled);
          var trimmed = _trimToLimit();
          _elWrapBtn.classList.toggle('active', _wrapEnabled);
          _saveSettings({ wrap: _wrapEnabled });
          if (_wrapEnabled && trimmed > 0) {
            _showToast(_t('ui.toast.wrapTrimmed', { n: _linesLimit }));
          } else {
            _showToast(_wrapEnabled ? _t('ui.toast.wrapOn') : _t('ui.toast.wrapOff'));
          }
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
          _showToast(_timestampEnabled ? _t('ui.toast.timestampsOn') : _t('ui.toast.timestampsOff'));
        });
      }

      // Colors (ANSI + format autodetect colorizing)
      if (_elColorsBtn) {
        _elColorsBtn.addEventListener('click', function() {
          _colorsEnabled = !_colorsEnabled;
          _elColorsBtn.classList.toggle('active', _colorsEnabled);
          _saveSettings({ colors: _colorsEnabled });
          _reHighlightAll();
          _showToast(_colorsEnabled ? _t('ui.toast.colorsOn') : _t('ui.toast.colorsOff'));
        });
      }

      // Index (in the server's sources list) of the source whose full log a
      // "read from beginning" request should load; the first one when none
      // is selected.
      function _visibleSourceIndexes() {
    var out = [];
    if (!_sources) return out;
    for (var i = 0; i < _sources.length; i++) {
      if (_hiddenNow().indexOf(i) === -1) out.push(i);
    }
    return out;
  }

  // Index (in the server's sources list) of the source whose log a read
  // request should use.
  function _readSourceIndex() {
        if (_selectedSource && _sources) {
          for (var k = 0; k < _sources.length; k++) {
            if (_sources[k].name === _selectedSource) return k;
          }
        }
        return _currentFileIndex;
      }

      // ── Download helper (shared by button + modal) ───────────────
      function _triggerDownload(sanitize) {
        var href;
        var label;
        if (_selectedSource && _sources) {
          var fileIdx = 0;
          var containerIdx = 0;
          var commandIdx = 0;
          for (var i = 0; i < _sources.length; i++) {
            var type = _sources[i].type;
            if (_sources[i].name === _selectedSource) {
              if (type === 'container') {
                href = _urlPath + '/download?container=' + containerIdx;
                label = 'Downloading container logs…';
              } else if (type === 'journal' || type === 'ssh') {
                href = _urlPath + '/download?command=' + commandIdx;
                label = 'Downloading ' + (type === 'journal' ? 'journal' : 'remote file') + '…';
              } else {
                href = _urlPath + '/download?file=' + fileIdx;
                label = 'Downloading file…';
              }
              break;
            }
            if (type === 'container') containerIdx++;
            else if (type === 'journal' || type === 'ssh') commandIdx++;
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
          _readSeq++;
          _pendingLogLines.length = 0;
          _liveBuffer.length = 0;
          _logFlushScheduled = false;
          _replayingLog = true;
          _socket.emit('read-from-start', { fileIndex: _readSourceIndex(), force: true, full: true, seq: _readSeq });
          _showToast(_t('ui.toast.loadingFull'));
        });
      }

      // ── Start N: bounded read of a file's tail ──────────────────────
      // (_startLines/START_LINES_KEY are initialised above, before first use.)

      // Only the last N lines are streamed (server-side `tail -n N`), so
      // pressing Start on a 500 MB log no longer reads the whole file.
      function _storedStartLines() {
        var raw;
        try { raw = window.localStorage.getItem(START_LINES_KEY); } catch { return 0; }
        var n = parseInt(raw, 10);
        return (n > 0 && n <= 1000000) ? n : 0;
      }
      function _loadStartLines() {
        return _storedStartLines() || DEFAULT_START_LINES;
      }
      function _refreshStartLabel() {
        var pretty = String(_startLines);
        if (_elReadStartLabel) _elReadStartLabel.textContent = _t('ui.controls.startLabel', { n: pretty });
        if (_elReadStartXBtn) {
          _elReadStartXBtn.setAttribute('aria-label', _t('ui.controls.readStartXAriaN', { n: pretty }));
          _elReadStartXBtn.title = _t('ui.controls.startXTitle', { n: pretty });
        }
        if (_elStartLinesBtn) _elStartLinesBtn.title = _t('ui.controls.startLinesTitle', { n: pretty });
      }
      function _setStartLines(value) {
        var n = parseInt(value, 10);
        if (!(n > 0 && n <= 1000000)) return false;
        _startLines = n;
        try { window.localStorage.setItem(START_LINES_KEY, String(n)); } catch { /* quota or private mode: keep the in-memory value */ }
        _refreshStartLabel();
        return true;
      }

      function _clearLogView() {
        if (_logContainer) _logContainer.innerHTML = '';
        _totalLines = 0; _visibleLines = 0; _errorCount = 0; _warnCount = 0; _lineNumber = 0;
        if (_updateStats) _updateStats();
      }
      // Killing the running read and clearing the pane keeps two backfills
      // from overlapping on screen, which used to lock the tab up.
      function _startRead(payload) {
        _readSeq++;
        _pendingLogLines.length = 0;
        _liveBuffer.length = 0;
        _olderLines.length = 0;
        _logFlushScheduled = false;
        _clearLogView();
        // A fresh read repaints the panel from the server, so the two pauses
        // that hold lines back must go with it. Automatic pause follows the
        // scroll position and cannot clear itself while a replay is running
        // (the scroll handler returns early on _replayingLog); the manual pause
        // drops every incoming line and only counted it as skipped. Either one
        // left set paints an empty panel over a live stream, which is exactly
        // what "Start" and "Start X" used to do for a reader who had scrolled
        // up or pressed Pause.
        _autoPaused = false;
        if (_isPaused) _setPauseState(false);
        _replayingLog = true;
        payload.seq = _readSeq;
        _socket.emit('read-from-start', payload);
      }
      function _requestRead(payload) {
        // A second click replaces the running read instead of queueing behind
        // it: the server drops the previous reader at the top of every read
        // call, so waiting for its 'read-end' only risks a stuck queue.
        _startRead(payload);
      }

      if (_elReadFromStartBtn) {
        // The whole file is delivered as one chunk: streaming it line by line
        // froze the tab on big logs. "Start X" below stays the bounded tail.
        _elReadFromStartBtn.addEventListener('click', function() {
          var budget = _refreshLineLimit();
      if (_selectedSource) {
        _requestRead({
          fileIndex: _readSourceIndex(),
          lines: budget
        });
      } else {
        // "All sources": pull the tail of every file that is switched on, with
        // one shared budget, instead of streaming one huge file in full.
        _requestRead({
          indexes: _visibleSourceIndexes(),
          lines: budget
        });
      }
          _showToast(_isContainer
            ? _t('ui.toast.requestingLogs')
            : _t('ui.toast.loadingFull'));
        });
      }

      if (_elReadStartXBtn) {
        _refreshStartLabel();
        _elReadStartXBtn.addEventListener('click', function() {
          // Same single-slot path as "Start": the running read is aborted first,
          // otherwise two backfills overlap and freeze the tab.
          _requestRead({ fileIndex: _readSourceIndex(), lines: _startLines });
          _showToast(_isContainer
            ? _t('ui.toast.requestingLogs')
            : _t('ui.toast.loadingLastN', { n: _startLines.toLocaleString() }));
        });
      }

      // ── Modals: "Set X" and the gear settings panel ─────────────
      var _elSetXOverlay    = document.getElementById('setXModalOverlay');
      var _elSetXInput      = document.getElementById('setXInput');
      var _elSetXSave       = document.getElementById('setXModalSave');
      var _elSetXCancel     = document.getElementById('setXModalCancel');
      var _elSettingsBtn    = document.getElementById('settingsBtn');
      var _elSettingsOverlay = document.getElementById('settingsModalOverlay');
      var _elSettingsX      = document.getElementById('settingsDefaultX');
      var _elSettingsLang   = document.getElementById('settingsLanguage');
      var _elSettingsBuf    = document.getElementById('settingsBufferLimit');
      var _elSettingsSave   = document.getElementById('settingsModalSave');
      var _elSettingsCancel = document.getElementById('settingsModalCancel');
      var _elSettingsReset  = document.getElementById('settingsModalReset');

      function _openSetXModal() {
        if (!_elSetXOverlay || !_elSetXInput) return false;
        _elSetXInput.value = String(_startLines);
        _elSetXOverlay.classList.remove('hidden');
        try { _elSetXInput.focus(); _elSetXInput.select(); } catch { /* focus may fail in exotic embeds */ }
        return true;
      }
      function _closeSetXModal() {
        if (_elSetXOverlay) _elSetXOverlay.classList.add('hidden');
      }
      function _openSettingsModal() {
        if (!_elSettingsOverlay) return false;
        if (_elSettingsX) _elSettingsX.value = String(_startLines);
        if (_elSettingsLang) _elSettingsLang.value = _currentLanguage();
        if (_elSettingsBuf) _elSettingsBuf.value = String(_bufferLimit);
        _hiddenDraft = _hiddenLogFiles.slice();
        _renderLogDirs();
        _elSettingsOverlay.classList.remove('hidden');
        try { if (_elSettingsX) { _elSettingsX.focus(); _elSettingsX.select(); } } catch { /* ignore */ }
        return true;
      }
      // Dismissing the dialog drops the checkbox draft: nothing is applied
      // and the sidebar keeps the state it had before the dialog opened.
      function _closeSettingsModal() {
        if (!_elSettingsOverlay) return;
        _hiddenDraft = null;
        _elSettingsOverlay.classList.add('hidden');
      }
      // Escape and an overlay click dismiss whichever panel is open.
      function _closeFloatingPanels() {
        var closed = false;
        if (_elSetXOverlay && !_elSetXOverlay.classList.contains('hidden')) { _closeSetXModal(); closed = true; }
        if (_elSettingsOverlay && !_elSettingsOverlay.classList.contains('hidden')) { _closeSettingsModal(); closed = true; }
        return closed;
      }
      function _onOverlayClick(overlay, close) {
        if (!overlay) return;
        overlay.addEventListener('click', function(e) {
          if (e.target === overlay) close();
        });
      }
      _onOverlayClick(_elSetXOverlay, _closeSetXModal);
      _onOverlayClick(_elSettingsOverlay, _closeSettingsModal);

      if (_elSetXCancel) _elSetXCancel.addEventListener('click', _closeSetXModal);
      if (_elSetXSave) {
        _elSetXSave.addEventListener('click', function() {
          if (!_setStartLines(_elSetXInput ? _elSetXInput.value : '')) {
            _showToast(_t('ui.toast.startXRange'));
            return;
          }
          _saveSettings({ startLines: _startLines });
          _closeSetXModal();
          _showToast(_t('ui.toast.startXUpdated', { n: _startLines.toLocaleString() }));
        });
      }
      if (_elSetXInput) {
        _elSetXInput.addEventListener('keydown', function(e) {
          if (e.key === 'Enter') { e.preventDefault(); if (_elSetXSave) _elSetXSave.click(); }
        });
      }

      if (_elStartLinesBtn) {
        _elStartLinesBtn.addEventListener('click', function() {
          if (_openSetXModal()) return;
          // Fallback for stripped markup: keep the old prompt path.
          var answer = window.prompt('How many lines should Start X load? (1–1000000)', String(_startLines));
          if (answer === null) return;
          if (_setStartLines(answer)) {
            _showToast(_t('ui.toast.startXUpdated', { n: _startLines.toLocaleString() }));
          } else {
            _showToast(_t('ui.toast.startXRange'));
          }
        });
      }

      if (_elSettingsBtn) _elSettingsBtn.addEventListener('click', _openSettingsModal);
      if (_elSettingsCancel) _elSettingsCancel.addEventListener('click', _closeSettingsModal);
      if (_elSettingsReset) {
        _elSettingsReset.addEventListener('click', function() {
          _setStartLines(DEFAULT_START_LINES);
          _bufferLimit = DEFAULT_LINES_LIMIT;
          // "Reset" means a clean slate: nothing is ticked, so the sidebar
          // stays empty until the operator picks the directories again.
          var _allHidden = [];
          for (var _k = 0; _k < _sources.length; _k++) _allHidden.push(_k);
          _hiddenLogFiles = _allHidden;
          _hiddenDraft = _allHidden.slice();
          _saveSettings({
            startLines: _startLines,
            language: 'auto',
            bufferLimit: _bufferLimit,
            hiddenLogFiles: _hiddenLogFiles
          });
          _applyLanguage('auto');
          _refreshLineLimit();
          if (_elSettingsX) _elSettingsX.value = String(_startLines);
          if (_elSettingsLang) _elSettingsLang.value = 'auto';
          if (_elSettingsBuf) _elSettingsBuf.value = String(_bufferLimit);
          _renderLogDirs();
          _applySourceVisibility();
          _buildSourceSelector(_sources);
          _showToast(_t('ui.toast.settingsReset'));
        });
      }
      if (_elSettingsSave) {
        _elSettingsSave.addEventListener('click', function() {
          if (_elSettingsX && !_setStartLines(_elSettingsX.value)) {
            _showToast(_t('ui.toast.startXRange'));
            return;
          }
          var _buf = _elSettingsBuf ? parseInt(_elSettingsBuf.value, 10) : _bufferLimit;
          if (!isFinite(_buf) || _buf < 100 || _buf > 1000000) {
            _showToast(_t('ui.toast.bufferRange'));
            return;
          }
          _bufferLimit = _buf;
          _refreshLineLimit();
          var lang = _elSettingsLang ? _elSettingsLang.value : 'auto';
          if (_hiddenDraft) {
            _hiddenLogFiles = _hiddenDraft;
            _hiddenDraft = null;
          }
          _saveSettings({ startLines: _startLines, language: lang, bufferLimit: _bufferLimit, hiddenLogFiles: _hiddenLogFiles });
          _applyLanguage(lang);
          _applySourceVisibility();
          _buildSourceSelector(_sources);
          _closeSettingsModal();
          _showToast(_t('ui.toast.settingsSaved'));
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
          _showToast(_t('ui.toast.themeChanged', { theme: _t('ui.theme.' + theme) }));
        });
      }

      // FAB
      if (_elFabScroll) {
        _elFabScroll.addEventListener('click', function() {
          _scrollToBottom({ resume: true });
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
        _elLogViewport.addEventListener('scroll', function() {
          // While a read replays, rows above the window are still arriving as
          // data. Pulling them back in here would fight the window trimmer, so
          // the restore waits until the replay is over.
          if (_replayingLog) return;
          if (_elLogViewport.scrollTop < 300 && _olderLines.length) _restoreOlderLines(200);
          // Away from the tail the log pauses itself: appended lines would move
          // the rows the reader is looking at. Coming back to the bottom drops
          // the pause and pours the buffered lines in.
          var atBottomNow = (_elLogViewport.scrollHeight - _elLogViewport.scrollTop - _elLogViewport.clientHeight) < 60;
          if (!atBottomNow && !_autoPaused) {
            _autoPaused = true;
          } else if (atBottomNow && _autoPaused) {
            _autoPaused = false;
            _flushLiveBuffer();
          }
          // Painting on every auto-scroll frame would repaint the tail over and
          // over while a replay streams in; the rows that stay unpainted are
          // painted when the replay ends or when the reader scrolls.
          if (!_isAtBottom && !_replayingLog) _schedulePaint();
        }, { passive: true });
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
          _showToast(_isPaused ? _t('ui.toast.pausedShort') : _t('ui.toast.resumedShort'));
        }
        if (e.key === 'Escape' && !inInput && _closeFloatingPanels()) {
          return;
        }
        if (e.key === 'Escape' && inInput) {
          if (_filterInput) { _filterInput.value = ''; }
          _filterValue = '';
          if (_elFilterClear) _elFilterClear.classList.add('hidden');
          _setFilterParam('');
          _filterAllLogs();
        }
        if (e.key === 'G' && e.shiftKey && !inInput) {
          _scrollToBottom({ resume: true });
        }
      });

      // Socket
      _socket = opts.socket;
      _socket
        .on('connect',       function() { _setConnStatus('connected',    _t('ui.status.connected')); })
        .on('disconnect',    function() { _setConnStatus('disconnected', _t('ui.status.disconnected')); })
        .on('connect_error', function() { _setConnStatus('disconnected', _t('ui.status.connectionError')); })
        .on('reconnecting',  function() { _setConnStatus('connecting',   _t('ui.status.reconnecting')); })
        .on('options:lines', function(limit) {
          _serverLinesLimit = (typeof limit === 'number' && isFinite(limit) && limit > 0)
            ? limit
            : DEFAULT_LINES_LIMIT;
          _refreshLineLimit();
        })
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
        .on('options:log-dirs', function(logDirs) {
          _logDirs = Array.isArray(logDirs) ? logDirs : [];
          _renderLogDirs();
          // The sidebar selector is built from options:sources before the log
          // dirs arrive, so rebuild it once we know the folder layout.
          _buildSourceSelector(_sources);
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
            FrontailFormats.setUserRules(rules);
          }
        })
        .on('file-start-info', function(data) {
          // A read that was replaced still announces itself late; its clear
          // would wipe the slice the newer read already put on screen.
          if (data && data.seq && data.seq !== _readSeq) return;
          if (data.tooLarge) {
            _openModal(data.size);
          } else {
            // Clear existing log and stream from start
            if (_logContainer) _logContainer.innerHTML = '';
            _totalLines = 0; _visibleLines = 0; _errorCount = 0; _warnCount = 0; _lineNumber = 0;
            _updateStats();
            _showToast(_t('ui.toast.streamingStart'));
          }
        })
        .on('read-end', function(payload) {
          // A superseded read stays silent on the server; drop anything that
          // still arrives late for a sequence we already left behind.
          if (payload && payload.seq && payload.seq !== _readSeq) return;
          _replayingLog = false;
          _schedulePaint();
          _showToast(_t('ui.toast.historyDone'));
        })
        .on('bulk-lines', function(payload) {
          // Whole file in one go: push straight into the frame batcher so the
          // tab stays responsive instead of appending thousands of nodes in
          // one tick.
          // A newer read request supersedes whatever was still in flight.
          if (payload && payload.seq && payload.seq !== _readSeq) return;
          var lines = (payload && payload.lines) || [];
          var bulkSource = payload && payload.s;
          if (!lines.length) return;
          var limit = (typeof _linesLimit === 'number' && isFinite(_linesLimit))
            ? _linesLimit
            : DEFAULT_LINES_LIMIT;
          var from = lines.length > limit ? lines.length - limit : 0;
          for (var i = from; i < lines.length; i++) {
            _pendingLogLines.push({ data: lines[i], source: bulkSource, replace: false });
          }
          _scheduleLogFlush();
        })
        .on('line', function(line) {
          var lineSource = typeof line === 'string' ? null : line.s;
          if (lineSource && !_sourceAllowed(lineSource)) return;
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
        // Wrapping survives a reload, so the smaller window has to come with it:
        // otherwise the first render already lays out thousands of wrapped rows.
        _refreshLineLimit();
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

      if (typeof _saved.bufferLimit === 'number' && _saved.bufferLimit >= 100 && _saved.bufferLimit <= 1000000) {
        _bufferLimit = Math.floor(_saved.bufferLimit);
        _refreshLineLimit();
      }

      // Restore hidden log files from directories
      if (_saved.hiddenLogFiles && Array.isArray(_saved.hiddenLogFiles)) {
        _hiddenLogFiles = _saved.hiddenLogFiles;
      }
      _collapsedLogDirs = _saved.collapsedLogDirs || [];
      // Initial render of log dirs (will be updated when options:log-dirs arrives)
      _renderLogDirs();

      // On mobile the sidebar is a full-screen sheet and starts collapsed;
      // on desktop it follows the saved preference (open by default).
      var _isMobile = window.matchMedia('(max-width: 640px)').matches;
      _setSidebarCollapsed(_isMobile || !!_saved.sidebarCollapsed, false);

      _loadSidebarWidth();
      _initSidebarResizer();
      if (_elSourceList) _elSourceList.classList.add('is-stack');

    },



    log: function log(data, source, replace) {
      if (!_logContainer) return;

      if (_autoPaused) {
        _liveBuffer.push([data, source]);
        if (_liveBuffer.length > LIVE_BUFFER_LIMIT) _liveBuffer.shift();
        return;
      }

      if (_totalLines === 0 && _elEmptyState) {
        _elEmptyState.classList.add('hidden');
      }

      var wasAtBottom = _isAtBottom;
      var level = _detectLevel(data);
      var visible = _lineIsVisible(data, source);

      var div = _buildLineNode({
        raw: data,
        source: source,
        level: level,
        visible: visible,
        num: ++_lineNumber,
        ts: _formatTimestamp()
      }, _renderBulk);

      // Bip check — only for live incoming lines, not replayed from start
      if (!replace) _checkBip(data);

      // Stats
      _totalLines++;
      if (level === 'error') _errorCount++;
      if (level === 'warn')  _warnCount++;
      if (visible)           _visibleLines++;

      if (!_renderBulk) _updateStats();

      if (replace && _logContainer.lastChild) {
        _logContainer.replaceChild(div, _logContainer.lastChild);
      } else if (_renderBulk && _bulkFragment) {
        _bulkFragment.appendChild(div);
      } else {
        _logContainer.appendChild(div);
      }

      // Trim to limit: live rows go through the same window as the bulk path,
      // otherwise they pile up in the document until the row budget is hit.
      if (!_renderBulk) _trimToLimit();

      if (!_renderBulk) {
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
    }

  };

}(window, document));