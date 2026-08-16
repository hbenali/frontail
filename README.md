# frontail — streaming logs to the browser

> **This repository is a fork of [mthenw/frontail](https://github.com/mthenw/frontail) by [@hbenali](https://github.com/hbenali), extended with a modernised UI, richer features, and an updated Docker base image.**

`frontail` is a Node.js application that streams log files to the browser — `tail -F` with a UI. Point it at any file (or stdin) and watch lines appear in real time.

---

## Quick start

```bash
npm i frontail -g
frontail /var/log/syslog
# open http://127.0.0.1:9001
```

Or with Docker:

```bash
docker run -d -p 9001:9001 -v /var/log:/log hbenali/frontail /log/syslog
```

---

## What's new in this fork

| Area | Change |
|---|---|
| **UI** | Full sidebar/main two-pane layout, JetBrains Mono log font |
| **Containers** | Stream logs from Docker or Podman containers alongside files |
| **Source selector** | Sidebar pills to filter by source — click a container or file to isolate its logs |
| **Themes** | Dark, Light, Solarized — switched at runtime with correct per-theme button colours |
| **Persistence** | Theme, word wrap, timestamps, filter, sidebar state, and source selection saved in `localStorage` |
| **Filter** | Regex mode, case-sensitive toggle, invert-filter, inline match highlighting |
| **Highlight** | Up to 5 colour-coded keyword highlighters, applied to all existing and new lines |
| **Stats** | Live counters for total / visible / error / warn lines |
| **Line numbers** | Gutter line numbers on every entry |
| **Timestamps** | Per-line `HH:MM:SS.ms` toggle |
| **Mobile** | Full-screen sidebar sheet, no horizontal scroll, word-wrap forced, safe-area aware |
| **Keyboard** | `Ctrl/Cmd+K` focus filter · `Space` pause · `Shift+G` jump to bottom · `Esc` clear |
| **Docker** | Multi-stage build, Node 24 LTS on Debian Bookworm Slim, non-root user |

---

## Features

- Real-time log streaming over WebSocket
- **Docker/Podman container log streaming** — `--container` flag, any engine
- **Source selector** — sidebar pills to filter logs by source (files or containers)
- **Container log download** — download full container history via browser
- Log rotation support (Linux/macOS)
- Auto-scroll with scroll-to-bottom FAB (shows `+N` new lines count)
- Pause / resume stream with skip counter
- Unread-line count in browser favicon
- Three built-in themes (Dark · Light · Solarized) — all settings persisted across sessions
- Advanced filter: plain text, regex, case-sensitive, invert
- Keyword highlight (up to 5 coloured keywords)
- ANSI colour code rendering
- **Automatic log colorizing** — autodetects apache2/nginx access & error logs, Tomcat/Catalina, and generic syslog, and colours timestamps, IPs, HTTP methods/status codes, log levels, etc. Enabled by default (`--ui-no-colors` to disable); skipped on lines that already carry ANSI colour codes
- **ANSI-source indicator** — badge shown when the current source already streams ANSI-coloured lines
- **Sanitized download** — when ANSI colours are detected, an extra "Sanitized" download strips the colour codes before saving
- Click any line to select / deselect
- Word wrap toggle
- Per-line timestamps toggle
- Live stats: total / visible / errors / warnings
- Tailing multiple files and stdin
- Basic authentication (`-U` / `-P`)
- HTTPS (`-k` / `-c`)
- Running behind a path prefix (`--url-path`, `--path`)
- Customisable log highlighting presets

---

## Installation

```bash
# npm (global)
npm i frontail -g

# Docker
docker run -d -p 9001:9001 -v /var/log:/log hbenali/frontail /log/syslog
```

---

## Usage

```
frontail [options] [file ...]

Options:
  -V, --version                 output the version number
  -h, --host <host>             listening host (default: 0.0.0.0)
  -p, --port <port>             listening port (default: 9001)
  -n, --number <number>         starting lines number (default: 10)
  -l, --lines <lines>           lines stored in browser (default: 2000)
  -t, --theme <theme>           name of the theme (default, dark)
  -d, --daemonize               run as daemon
  -U, --user <username>         Basic Auth username (requires -P)
  -P, --password <password>     Basic Auth password (requires -U)
  -k, --key <key.pem>           Private key for HTTPS (requires -c)
  -c, --certificate <cert.pem>  Certificate for HTTPS (requires -k)
  -C, --container <container>   container name or id
  --container-engine <engine>   container engine (docker, podman) (default: docker)
  --pid-path <path>             daemon PID file (default: /var/run/frontail.pid)
  --log-path <path>             daemon log file (default: /dev/null)
  --url-path <path>             URL path for browser app (default: /)
  --ui-hide-topbar              hide topbar
  --ui-no-indent                don't indent log lines
  --ui-highlight                enable word/line highlighting
  --ui-highlight-preset <path>  custom highlight preset JSON
  --ui-no-colors                disable log colorizing (ANSI + format autodetection), on by default
  --path <path>                 prefix path (default: /)
  --disable-usage-stats         disable anonymous usage statistics
  --help                        output usage information
```

Web interface: **http://[host]:[port]**

---

## Keyboard shortcuts

| Key | Action |
|---|---|
| `Ctrl/Cmd + K` | Focus filter input |
| `Space` | Pause / resume stream |
| `Shift + G` | Scroll to bottom |
| `Esc` | Clear filter |

---

## Mobile

On small screens the sidebar becomes a full-screen overlay panel. Tap the **☰** icon in the top-left to open it, and use the **←** button inside to close it and return to the log view. Logs wrap to the window width with no horizontal scroll.

---

## Tailing multiple files

`[file ...]` accepts multiple paths and shell glob patterns. Each file becomes a separate **source pill** in the sidebar:

```bash
frontail /var/log/nginx/access.log /var/log/nginx/error.log
frontail /var/log/*.log
```

## Mixing files and containers

Files and containers can be tailed simultaneously — each appears as its own pill:

```bash
frontail /var/log/syslog --container nginx -C postgres
```

## stdin

Use `-` to stream stdin:

```bash
./server | frontail -
```

## Docker/Podman container logs

Stream logs from one or more containers:

```bash
frontail --container my-container
frontail -C c1 -C c2
```

Specify container engine (default is `docker`):

```bash
frontail --container my-container --container-engine podman
```

### Downloading container logs

Click a container source pill in the sidebar, then press **Download** to get the full log history as a `.log` file.

### Docker setup for container streaming

To stream container logs from within the frontail Docker image, mount the Docker socket:

```yaml
# docker-compose.yml
frontail:
  image: hbenali/frontail:2.0
  command: --container myapp /logs/syslog
  volumes:
    - /var/log:/logs:ro
    - /var/run/docker.sock:/var/run/docker.sock:ro
```

The entrypoint automatically adds the `frontail` user to the socket's group at startup.

---

## Highlighting presets

`--ui-highlight` enables log highlighting. The default preset is `./preset/default.json`:

```json
{
  "words": {
    "err": "color: red;"
  },
  "lines": {
    "err": "font-weight: bold;"
  }
}
```

Available presets: `default`, `npmlog`, `python`.

---

## Log colorizing

Enabled by default — pass `--ui-no-colors` to turn it off server-wide. Each viewer can also flip the **Colors** button in the sidebar; that per-browser choice is saved and overrides the server default.

Two things happen per line, depending on whether it already carries ANSI escape codes:

- **Line already has ANSI codes** (e.g. an app logging with `chalk`/`colorlog`): they're rendered as-is, and format autodetection is skipped for that line so colours don't clash. A small **ANSI colors** badge appears in the topbar the first time this is seen, and a **Sanitized** download button appears in the sidebar controls.
- **Plain-text line**: frontail tries to recognise the log format and colours the relevant fields — timestamps, IPs, HTTP methods/paths, status codes (2xx green, 3xx cyan, 4xx amber, 5xx red), thread/pid, and log level. Recognised formats:
  - Apache2 / Nginx combined & common access logs
  - Apache2 error log (classic and `[core:error]`/`[pid N]` styles)
  - Nginx error log
  - Tomcat/Catalina (`juli` one-line format and the classic two-line format)
  - Generic syslog

Turning colors off also falls back to plain text for ANSI-coloured sources (no `ansi_to_html`), useful when a source's colours are noisy or clash with your theme.

### Sanitized download

If a source contains ANSI codes, the sidebar shows a **Sanitized** download button alongside the normal **Download** button. It streams the same file/container log through `/download?...&sanitize=1`, which strips ANSI escape sequences line-by-line server-side before sending it — handy for pasting logs elsewhere without stray escape codes.

---

## Running behind nginx

```nginx
events { worker_connections 1024; }

http {
  server {
    listen 8080;

    location /frontail {
      proxy_pass http://127.0.0.1:9001/frontail;
      proxy_http_version 1.1;
      proxy_set_header Upgrade    $http_upgrade;
      proxy_set_header Connection "upgrade";
    }
  }
}
```

Start frontail with `--url-path /frontail`.

---

## Docker

```bash
# Build
docker build -t hbenali/frontail .

# Multi-arch build & push
docker buildx build --platform linux/amd64,linux/arm64 \
  -t hbenali/frontail:2.0 -t hbenali/frontail:latest --push .

# Run (file only)
docker run -d \
  -p 9001:9001 \
  -v /var/log:/log \
  hbenali/frontail /log/syslog

# Run (file + container streaming)
docker run -d \
  -p 9001:9001 \
  -v /var/log:/log:ro \
  -v /var/run/docker.sock:/var/run/docker.sock:ro \
  hbenali/frontail /log/syslog --container myapp
```

The image uses a **multi-stage build** (Node 24 LTS on Debian Bookworm Slim), includes `docker-ce-cli` for container streaming, and runs as a non-root `frontail` user. The entrypoint script adds the user to the docker group at runtime when `docker.sock` is mounted.

---

## Credits

- Original project: **[mthenw/frontail](https://github.com/mthenw/frontail)** by Maciej Winnicki
- This fork maintained by **[@hbenali](https://github.com/hbenali)**

## License

MIT
