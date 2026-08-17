#!/bin/sh

set -eu

# If docker.sock is mounted, add frontail user to the socket's group
if [ -S /var/run/docker.sock ]; then
  DOCKER_GID=$(stat -c '%g' /var/run/docker.sock)
  if getent group "$DOCKER_GID" >/dev/null 2>&1; then
    DOCKER_GROUP=$(getent group "$DOCKER_GID" | cut -d: -f1)
  else
    DOCKER_GROUP=docker
    addgroup -g "$DOCKER_GID" "$DOCKER_GROUP" 2>/dev/null || true
  fi
  addgroup frontail "$DOCKER_GROUP" 2>/dev/null || true
fi

exec su-exec frontail ./bin/frontail "$@"
