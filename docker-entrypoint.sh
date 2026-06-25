#!/bin/bash

set -euo pipefail

# If docker.sock is mounted, add frontail user to the socket's group
if [ -S /var/run/docker.sock ]; then
  DOCKER_GID=$(stat -c '%g' /var/run/docker.sock)
  if getent group "$DOCKER_GID" >/dev/null 2>&1; then
    DOCKER_GROUP=$(getent group "$DOCKER_GID" | cut -d: -f1)
  else
    DOCKER_GROUP=docker
    groupadd -g "$DOCKER_GID" "$DOCKER_GROUP" 2>/dev/null || true
  fi
  usermod -a -G "$DOCKER_GROUP" frontail 2>/dev/null || true
fi

exec gosu frontail ./bin/frontail "$@"
