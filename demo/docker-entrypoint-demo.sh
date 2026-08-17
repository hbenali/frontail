#!/bin/sh

set -eu

DEMO_DIR="${DEMO_LOG_DIR:-/demo}"
mkdir -p "$DEMO_DIR"

# Re-seed on every start so restarts (e.g. Render free-tier spin-down) don't
# carry forward an unbounded amount of appended demo content.
cp -f /frontail/demo/seed/*.log /frontail/demo/seed/*.out "$DEMO_DIR"/ 2>/dev/null || true
chown -R frontail:frontail "$DEMO_DIR"

# Background generator keeps appending fake lines so the demo looks live.
su-exec frontail node /frontail/demo/generate-demo-logs.js &

# Render (and most PaaS hosts) expect the app to listen on $PORT.
set -- --port "${PORT:-9001}" "$@"

exec /frontail/docker-entrypoint.sh "$@"
