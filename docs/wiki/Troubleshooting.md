# Troubleshooting

## The page loads but no logs show up

1. **Look at the log view first.** Problems reading a source are shown there as `[frontail] <source>: <reason>`:
   - `cannot open ... Permission denied`: the user running frontail can't read the file. `ls -l` it; add the user to the file's group (often `adm`), or fix the file's mode. In Docker the process is a non-root user, so a root-only host file fails the same way.
   - `cannot open ... No such file or directory`: wrong path. frontail keeps waiting and starts streaming if the file appears later.
   - `ssh exited with code N`: the SSH connection failed or dropped (see below).
2. **Check the server's own output.** Run it in the foreground and read stderr.
3. **Behind a reverse proxy?** See "Log view empty behind a proxy".

## "Syslog isn't working" / `/var/log/syslog` doesn't exist

Many current distributions (Fedora, Arch, recent Debian and Ubuntu) log to the systemd **journal** and have no `/var/log/syslog`; `/var/log/messages` may exist but be readable only by root. Use the journal:

```bash
frontail --journal
```

The user needs access to the journal (member of `systemd-journal` or `adm`). To follow only some services: `--journal-unit sshd --journal-unit nginx`.

## Log view empty behind a proxy

Two usual causes:

- The proxy doesn't forward WebSocket upgrades. Add `proxy_http_version 1.1;` and the `Upgrade`/`Connection` headers ([Reverse proxy](Reverse-proxy)).
- The proxy rewrites `Host`, so frontail's cross-site check rejects the browser. Keep the original host (`proxy_set_header Host $host;`) or add `--allowed-origin https://your-public-host`.

## SSH sources

- `Permission denied (publickey...)`: ssh never prompts (`BatchMode=yes`). Set up key auth for the user running frontail, and make sure the host key is already trusted (`ssh host true` once by hand).
- `Could not resolve hostname`, `Connection timed out`: network or DNS. The connect timeout is 10 s.
- `ssh exited with code N; no more lines will arrive`: the session dropped. frontail does not reconnect; restart it, or use a supervisor.
- Ports, keys and jump hosts come from `~/.ssh/config`.

## Colors are off

- Make sure you're on 2.31 or later: 2.28 to 2.30 had a bug that turned colorizing and indentation off by default.
- The **Colors** button in the sidebar overrides the server default per browser; check it's active.
- Lines that already contain ANSI codes keep their own colors and skip format detection.

## Container logs

- `Failed to spawn docker`: the engine isn't installed or isn't on `PATH` (use `--container-engine podman` for Podman).
- In the Docker image, mount the socket: `-v /var/run/docker.sock:/var/run/docker.sock:ro`.

## Other

- **`Arguments needed, use --help`**: give at least one source (a file, `-`, `-C`, `--journal`, `--ssh`) or a `files` list in the config file.
- **Port already in use**: change `-p`.
- **Node too old**: frontail needs Node 22.12+ (the Docker image and binaries bundle their own).
- **`Unknown option "x" in config file`**: config keys must match option names; see [Configuration file](Configuration-file).
- **Still stuck?** [Open an issue](https://github.com/hbenali/frontail/issues/new) with your version (`frontail -V`), the command line (without secrets) and what the log view says.
