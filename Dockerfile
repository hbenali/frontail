# ── Stage 1: build ───────────────────────────────────────────────────────────
FROM node:24-bookworm-slim AS builder

WORKDIR /build

# Copy manifests first for layer-cache efficiency
COPY package.json package-lock.json ./

# Install production deps only, skip optional and audit noise
RUN npm ci --omit=dev --ignore-scripts

# ── Stage 2: runtime ─────────────────────────────────────────────────────────
FROM node:24-bookworm-slim AS runtime

# Install docker CLI (lightweight, no daemon) for container log streaming
# Also install gosu for privilege drop after docker socket group setup
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl gosu \
 && install -m 0755 -d /etc/apt/keyrings \
 && curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc \
 && chmod a+r /etc/apt/keyrings/docker.asc \
 && echo "deb [signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian bookworm stable" \
      > /etc/apt/sources.list.d/docker.list \
 && apt-get update && apt-get install -y --no-install-recommends docker-ce-cli \
 && apt-get purge -y curl \
 && rm -rf /var/lib/apt/lists/*

# Security: run as non-root with fixed uid:gid
RUN groupadd --gid 1001 frontail \
 && useradd  --uid 1001 --gid frontail --shell /bin/sh --create-home frontail

WORKDIR /frontail

# Copy only what is needed to run
COPY --from=builder /build/node_modules ./node_modules
COPY bin       ./bin
COPY lib       ./lib
COPY web       ./web
COPY preset    ./preset
COPY index.js       ./
COPY package.json   ./
COPY docker-entrypoint.sh ./

RUN chmod +x docker-entrypoint.sh bin/frontail

# Run entrypoint as root so it can set up docker group, then drop to frontail
USER root

EXPOSE 9001

ENTRYPOINT ["/frontail/docker-entrypoint.sh"]
CMD ["--help"]

