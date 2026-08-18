# ── Stage 1: build ───────────────────────────────────────────────────────────
FROM node:24-alpine AS builder

WORKDIR /build

# Copy manifests first for layer-cache efficiency
COPY package.json package-lock.json ./

# Install production deps only, skip optional and audit noise
RUN npm ci --omit=dev --ignore-scripts

# ── Stage 2: runtime ─────────────────────────────────────────────────────────
FROM node:24-alpine AS runtime

# Passed at build time via --build-arg; see README's "Docker" section
ARG FRONTAIL_VERSION=0.0.0-dev
ARG FRONTAIL_REVISION=""

LABEL org.opencontainers.image.title="frontail" \
      org.opencontainers.image.description="streaming logs to the browser" \
      org.opencontainers.image.source="https://github.com/hbenali/frontail" \
      org.opencontainers.image.url="https://github.com/hbenali/frontail" \
      org.opencontainers.image.documentation="https://github.com/hbenali/frontail#readme" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.authors="Houssem Ben Ali <hbenali.tn@gmail.com>" \
      org.opencontainers.image.version="${FRONTAIL_VERSION}" \
      org.opencontainers.image.revision="${FRONTAIL_REVISION}"

# Install docker CLI (lightweight, no daemon) for container log streaming.
# su-exec is Alpine's minimal gosu equivalent, used for privilege drop after
# docker socket group setup. docker-cli is pulled from Alpine edge: the
# pinned stable release (3.24) only ships 29.5.3-r0, which carries several
# fixed-upstream CVEs; edge already has 29.7.2-r0. Everything else stays on
# the pinned stable base.
RUN apk add --no-cache \
      --repository=https://dl-cdn.alpinelinux.org/alpine/edge/community \
      --repository=https://dl-cdn.alpinelinux.org/alpine/edge/main \
      ca-certificates curl docker-cli su-exec

# The base image bundles npm/corepack/yarn for building; this runtime image
# only ever runs index.js directly, so drop them (also removes their
# transitive CVEs from the image).
RUN rm -rf \
      /usr/local/lib/node_modules/npm \
      /usr/local/lib/node_modules/corepack \
      /usr/local/bin/npm \
      /usr/local/bin/npx \
      /usr/local/bin/corepack \
      /opt/yarn-v* \
      /usr/local/bin/yarn \
      /usr/local/bin/yarnpkg

# Security: run as non-root with fixed uid:gid
RUN addgroup -g 1001 frontail \
 && adduser -D -u 1001 -G frontail -s /bin/sh frontail

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

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD curl -fsS http://127.0.0.1:9001/healthz || exit 1

ENTRYPOINT ["/frontail/docker-entrypoint.sh"]
CMD ["--help"]

