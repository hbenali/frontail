# Log sources

Every source appears as its own pill in the sidebar. Click a pill to isolate that source; **All** shows everything interleaved. Sources can be mixed freely.

## Files

```bash
frontail /var/log/nginx/access.log /var/log/nginx/error.log
frontail /var/log/*.log
```

Log rotation is handled (`tail -F`). The last `-n` lines are shown on start.

If a file can't be read, frontail says so in the log view, e.g. `[frontail] /var/log/messages: cannot open ... Permission denied`. See [Troubleshooting](Troubleshooting).

## stdin

```bash
./server | frontail -
```

## Docker / Podman containers

```bash
frontail --container my-container
frontail -C c1 -C c2
frontail -C my-container --container-engine podman
```

Select a container pill and press **Download** for its full history. From inside the frontail Docker image you must mount the Docker socket, see [Docker and Kubernetes](Docker-and-Kubernetes).

## systemd journal

Systems without `/var/log/syslog` (Fedora, Arch, recent Debian and Ubuntu) keep their logs in the journal:

```bash
frontail --journal                                  # everything
frontail --journal-unit sshd --journal-unit nginx   # selected units
```

The user running frontail must be allowed to read the journal (member of `systemd-journal` or `adm`). Journal lines use the classic syslog layout, so they are colorized as syslog.

## Remote files over SSH

```bash
frontail --ssh deploy@web1:/var/log/syslog --ssh deploy@web2:/var/log/nginx/error.log
```

- Uses your normal `~/.ssh/config` (ports, keys, jump hosts) with `BatchMode=yes`: ssh never prompts, so keys must be set up and the host key already trusted.
- The remote path must be absolute. frontail validates the host and quotes the path so a hostile value can't inject ssh options or remote commands.
- If the session drops, the view says `ssh exited with code N; reconnecting in Ns` and frontail reconnects with exponential backoff (2 s, 4 s, ... up to 60 s; back to 2 s after a connection that lasted 30 s). Reconnects use `-n 0`, so lines already shown aren't repeated; anything written while the link was down is not replayed. Keepalives (`ServerAliveInterval=15`) make a silently dead connection get noticed within about a minute.
- The same reconnect applies to `--journal`. If a program isn't installed (`Failed to run ssh: ... ENOENT`) frontail doesn't retry.

## Mixing sources

```bash
frontail /var/log/app.log -C api --journal-unit sshd --ssh web1:/var/log/syslog
```

## Reading from the beginning

Select a source and press **Start** to load its whole history (for files over 50 MB you are asked to confirm). **Download** saves the full log. Both work for files, containers, the journal and ssh sources.
