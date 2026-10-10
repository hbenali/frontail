// Keyword and preset highlighting of already-escaped log html. Pure
// functions: window.FrontailHighlight in the browser, require() in Node.
(function(root) {
  'use strict';

  var Util = root.FrontailUtil || (typeof require === 'function' ? require('./util') : null);

  // Wraps each word of the server preset's `words` map in a styled span.
  // config = { words: { word: 'css' }, lines: { text: 'css' } } (--ui-highlight)
  function applyServerWords(line, config) {
    var out = line;
    if (config && config.words) {
      Object.keys(config.words).forEach(function(w) {
        out = out.replace(
          new RegExp('(?![^<]*>)(' + Util.escapeRegExp(w) + ')', 'g'),
          '<span style="' + config.words[w] + '">$1</span>'
        );
      });
    }
    return out;
  }

  // Styles the whole line element when its text contains a `lines` key.
  function applyServerLine(text, container, config) {
    if (config && config.lines) {
      Object.keys(config.lines).forEach(function(check) {
        if (text.indexOf(check) !== -1) {
          container.setAttribute('style', config.lines[check]);
        }
      });
    }
    return container;
  }

  // User keywords ([{ word }]) get cycling css classes (case-insensitive).
  function applyKeywords(html, keywords, cssClasses) {
    keywords.forEach(function(h, idx) {
      var cls = cssClasses[idx % cssClasses.length];
      html = html.replace(
        new RegExp('(?![^<]*>)(' + Util.escapeRegExp(h.word) + ')', 'gi'),
        '<span class="' + cls + '">$1</span>'
      );
    });
    return html;
  }

  var api = {
    applyServerWords: applyServerWords,
    applyServerLine: applyServerLine,
    applyKeywords: applyKeywords
  };

  root.FrontailHighlight = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
