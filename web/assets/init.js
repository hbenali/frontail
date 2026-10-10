/* global App:false */
// Page bootstrap. Kept out of index.html so the Content-Security-Policy can
// disallow inline scripts; the server-side values arrive as data attributes.
(function() {
  var cfg = document.currentScript.dataset;
  window._frontailPath = cfg.path;
  window._frontailVersion = cfg.version;
  var socket = io.connect('/' + cfg.namespace, {
    path: cfg.path + '/socket.io',
    transports: ['websocket']
  });
  window.load = App.init({
    socket: socket,
    container: document.getElementById('logContainer'),
    filterInput: document.getElementById('filterInput'),
    pauseBtn: document.getElementById('pauseBtn'),
    topbar: document.getElementById('topbar'),
    body: document.body
  });
})();
