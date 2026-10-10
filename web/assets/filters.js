// Which log lines are visible: text filter (plain/regex, case, invert), the
// selected source and the level chips. Pure functions over a plain `state`
// object, so they run in the browser (window.FrontailFilters) and in Node.
//
// state = {
//   filterValue: string, regexMode: boolean, caseSensitive: boolean,
//   invertFilter: boolean, selectedSource: string|null,
//   levelFilters: { error, warn, info, debug: boolean }
// }
(function(root) {
  'use strict';

  var Util = root.FrontailUtil || (typeof require === 'function' ? require('./util') : null);
  var Formats = root.FrontailFormats || (typeof require === 'function' ? require('./formats') : null);

  // The same compiled regex is needed for every incoming line while the
  // filter is unchanged, so remember the last one.
  var cache = { key: null, rx: null };

  // The RegExp for the current text filter, or null (no filter / invalid regex).
  function buildRegex(state) {
    if (!state.filterValue) return null;
    var key = (state.regexMode ? 'r' : 'p') + (state.caseSensitive ? 'c' : 'i') + ':' + state.filterValue;
    if (cache.key === key) return cache.rx;
    var rx;
    try {
      var pattern = state.regexMode ? state.filterValue : Util.escapeRegExp(state.filterValue);
      rx = new RegExp(pattern, state.caseSensitive ? '' : 'i');
    } catch {
      rx = null; // invalid user regex
    }
    cache = { key: key, rx: rx };
    return rx;
  }

  function matchesText(text, state) {
    if (!state.filterValue) return true;
    var rx = buildRegex(state);
    if (!rx) return true; // an invalid regex hides nothing
    return state.invertFilter ? !rx.test(text) : rx.test(text);
  }

  function matchesSource(source, state) {
    if (!state.selectedSource) return true;
    return source === state.selectedSource;
  }

  function matchesLevel(text, state) {
    var level = Formats.detectLevel(text);
    if (!level) return true; // unclassified lines are never hidden by level chips
    return !!state.levelFilters[level];
  }

  function isVisible(text, source, state) {
    return matchesText(text, state) && matchesSource(source, state) && matchesLevel(text, state);
  }

  // Wraps the filter matches in already-escaped html in <mark>, leaving tags alone.
  function highlightMatches(html, state) {
    if (!state.filterValue) return html;
    var rx = buildRegex(state);
    if (!rx) return html;
    return html.replace(
      new RegExp('(?![^<]*>)(' + rx.source + ')', state.caseSensitive ? 'g' : 'gi'),
      '<mark class="search-highlight">$1</mark>'
    );
  }

  var api = {
    buildRegex: buildRegex,
    matchesText: matchesText,
    matchesSource: matchesSource,
    matchesLevel: matchesLevel,
    isVisible: isVisible,
    highlightMatches: highlightMatches
  };

  root.FrontailFilters = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
