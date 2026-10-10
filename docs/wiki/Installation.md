# Installation

Requires **Node.js 22.12 or newer** for the npm install. Docker and the standalone binaries bring their own runtime.

## npm

```bash
npm i -g @hbenali/frontail
frontail /var/log/syslog
```

Then open `http://127.0.0.1:9001`.

## Docker

Images are published to [Docker Hub](https://hub.docker.com/r/hbenali/frontail) and [GHCR](https://github.com/hbenali/frontail/pkgs/container/frontail) (multi-arch: amd64 and arm64):

```bash
docker run -d -p 9001:9001 -v /var/log:/log:ro hbenali/frontail /log/syslog
# or
docker run -d -p 9001:9001 -v /var/log:/log:ro ghcr.io/hbenali/frontail /log/syslog
```

See [Docker and Kubernetes](Docker-and-Kubernetes) for Compose, container-log streaming and Kubernetes.

## Standalone binaries

Binaries (no Node.js needed) for Linux, macOS and Windows, amd64 and arm64, are attached to every [GitHub release](https://github.com/hbenali/frontail/releases/latest).

macOS binaries are unsigned, so Gatekeeper blocks the first launch. Run once:

```bash
xattr -d com.apple.quarantine ./frontail-*
```

(or right-click → Open).

## Running as a daemon

```bash
frontail -d --pid-path ./frontail.pid --log-path ./frontail.log /var/log/syslog
```

All options, including `--config`, containers, `--journal` and `--ssh`, are carried over to the daemon. Basic Auth credentials are handed to it through environment variables, so they never appear in `ps`.

## Upgrading

Check the [release notes](https://github.com/hbenali/frontail/releases). Notable upgrade notes:

- **2.31**: browsers may only open the log socket from the page's own host. Behind a proxy that rewrites `Host`, add `--allowed-origin https://your-public-host` (see [Security](Security)).
- **2.29**: requires Node 22.12+.
- **2.28 to 2.30**: log colorizing and indentation were accidentally off by default. Fixed in 2.31.
