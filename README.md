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
| **Themes** | Dark, Light, Solarized — switched at runtime with correct per-theme button colours |
| **Persistence** | Theme, word wrap, timestamps, filter, and sidebar state saved in `localStorage` |
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
- Log rotation support (Linux/macOS)
- Auto-scroll with scroll-to-bottom FAB (shows `+N` new lines count)
- Pause / resume stream with skip counter
- Unread-line count in browser favicon
- Three built-in themes (Dark · Light · Solarized) — all settings persisted across sessions
- Advanced filter: plain text, regex, case-sensitive, invert
- Keyword highlight (up to 5 coloured keywords)
- ANSI colour code rendering
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
  --pid-path <path>             daemon PID file (default: /var/run/frontail.pid)
  --log-path <path>             daemon log file (default: /dev/null)
  --url-path <path>             URL path for browser app (default: /)
  --ui-hide-topbar              hide topbar
  --ui-no-indent                don't indent log lines
  --ui-highlight                enable word/line highlighting
  --ui-highlight-preset <path>  custom highlight preset JSON
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

`[file ...]` accepts multiple paths and shell glob patterns:

```bash
frontail /var/log/nginx/access.log /var/log/nginx/error.log
frontail /var/log/*.log
```

## stdin

Use `-` to stream stdin:

```bash
./server | frontail -
```

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

# Run
docker run -d \
  -p 9001:9001 \
  -v /var/log:/log \
  hbenali/frontail /log/syslog
```

The image uses a **multi-stage build** (Node 24 LTS on Debian Bookworm Slim) and runs as a non-root user for improved security.

---

## Credits

- Original project: **[mthenw/frontail](https://github.com/mthenw/frontail)** by Maciej Winnicki
- This fork maintained by **[@hbenali](https://github.com/hbenali)**

## License

MIT
