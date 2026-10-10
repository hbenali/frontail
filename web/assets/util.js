// Small pure helpers shared by the browser UI. No DOM, no globals: runs in the
// browser (window.FrontailUtil) and in Node tests (require).
(function(root) {
  'use strict';

  // Returns a function that runs fn once, ms after the last call (arguments
  // are ignored, as the callers only use it to coalesce work).
  function debounce(fn, ms) {
    var t;
    return function() { clearTimeout(t); t = setTimeout(fn, ms); };
  }

  function escapeRegExp(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function escapeHtml(str) {
    return str
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function basename(p) {
    if (!p) return p;
    var parts = String(p).split('/');
    return parts[parts.length - 1] || p;
  }

  function formatBytes(bytes) {
    if (bytes < 1024)        return bytes + ' B';
    if (bytes < 1048576)     return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1073741824)  return (bytes / 1048576).toFixed(1) + ' MB';
    return (bytes / 1073741824).toFixed(2) + ' GB';
  }

  var api = {
    debounce: debounce,
    escapeRegExp: escapeRegExp,
    escapeHtml: escapeHtml,
    basename: basename,
    formatBytes: formatBytes
  };

  root.FrontailUtil = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
