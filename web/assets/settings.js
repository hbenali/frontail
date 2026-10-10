// Per-browser settings persisted in localStorage (theme, filters, sidebar,
// ...). The storage is injected so it can be faked in tests, and every access
// is guarded: localStorage can be missing or throw (private browsing, quota,
// blocked site data).
(function(root) {
  'use strict';

  var STORAGE_KEY = 'frontail:settings';

  // getStorage: () => Storage-like { getItem, setItem }
  function create(getStorage) {
    function load() {
      try {
        var raw = getStorage().getItem(STORAGE_KEY);
        return raw ? JSON.parse(raw) : {};
      } catch { return {}; }
    }

    // Merges patch into the stored settings.
    function save(patch) {
      try {
        var merged = Object.assign({}, load(), patch);
        getStorage().setItem(STORAGE_KEY, JSON.stringify(merged));
      } catch { /* localStorage unavailable (private browsing, quota, etc.) */ }
    }

    return { load: load, save: save };
  }

  var api = { create: create, STORAGE_KEY: STORAGE_KEY };

  root.FrontailSettings = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
