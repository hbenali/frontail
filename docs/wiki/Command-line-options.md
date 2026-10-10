# Command-line options

```
frontail [options] [file ...]
```

Any option can also be set in a [configuration file](Configuration-file). Command-line flags win over the file.

## Server

| Option | Default | Description |
| --- | --- | --- |
| `-h, --host <host>` | `0.0.0.0` | Listening host |
| `-p, --port <port>` | `9001` | Listening port |
| `--url-path <path>` | `/` | URL path the app is served under (for [reverse proxies](Reverse-proxy)) |
| `-d, --daemonize` | | Run as a daemon |
| `--pid-path <path>` | `/var/run/frontail.pid` | Daemon PID file |
| `--log-path <path>` | `/dev/null` | Daemon log file |
| `--config <path>` | | JSON [configuration file](Configuration-file) |
| `--metrics` | off | Expose Prometheus metrics at `<url-path>/metrics` ([details](Metrics-and-health)) |

## Sources

| Option | Description |
| --- | --- |
| `[file ...]` | Files to tail; shell globs work. `-` reads stdin |
| `-C, --container <container>` | Docker/Podman container name or id (repeatable) |
| `--container-engine <engine>` | `docker` (default) or `podman` |
| `--journal` | Follow the systemd journal |
| `--journal-unit <unit>` | Follow one systemd unit (repeatable, implies `--journal`) |
| `--ssh <target>` | Follow a remote file: `[user@]host:/absolute/path` (repeatable) |
| `-n, --number <number>` | Lines to show on start (default 10) |

Details and examples: [Log sources](Log-sources).

## Security

| Option | Description |
| --- | --- |
| `-U, --user <username>` | Basic Auth user (also `FRONTAIL_USER`) |
| `-P, --password <password>` | Basic Auth password (also `FRONTAIL_PASSWORD`). Visible in `ps`; prefer `--password-file` |
| `--password-file <path>` | Read the password from a file, e.g. a Docker/Kubernetes secret |
| `-k, --key <key.pem>` / `-c, --certificate <cert.pem>` | Serve HTTPS (both required) |
| `--allowed-origin <origin>` | Extra browser origin allowed to open the log socket (repeatable) |

Details: [Security](Security).

## Web UI

| Option | Description |
| --- | --- |
| `-l, --lines <lines>` | Lines kept in the browser (default 2000) |
| `-t, --theme <theme>` | `default` or `dark` start theme |
| `--ui-hide-topbar` | Hide the topbar |
| `--ui-no-indent` | Don't indent log lines |
| `--ui-no-colors` | Start with colorizing off (viewers can still toggle it) |
| `--ui-colors-preset <path>` | Extra colorizing rules: [Custom format rules](Custom-format-rules) |
| `--ui-highlight` | Enable word/line highlighting |
| `--ui-highlight-preset <path>` | Custom highlight preset (see [Web UI guide](Web-UI-guide)) |

## Other

| Option | Description |
| --- | --- |
| `-V, --version` | Print the version |
| `--help` | Print usage |
| `--disable-usage-stats` | Deprecated no-op (usage statistics were removed) |
