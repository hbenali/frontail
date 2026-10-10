'use strict';

/**
 * Cross-site WebSocket hijacking guard. Browsers always send an Origin
 * header on WebSocket/XHR handshakes and scripts cannot forge it, so a
 * page on another site connecting to a frontail the visitor can reach is
 * rejected here. Requests without an Origin (curl, server-side clients)
 * are not browser-driven and are allowed.
 *
 * Allowed: same host as the request's Host header, or an explicitly
 * configured origin (needed when a reverse proxy rewrites Host).
 */
module.exports = (origin, host, allowedOrigins) => {
  if (!origin) return true;

  const allowed = (allowedOrigins || []).map((o) => o.replace(/\/$/, ''));
  if (allowed.includes(origin.replace(/\/$/, ''))) return true;

  let originHost;
  try {
    originHost = new URL(origin).host;
  } catch {
    return false; // includes the literal "null" origin (sandboxed iframes, file://)
  }
  return !!host && originHost.toLowerCase() === host.toLowerCase();
};
