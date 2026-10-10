![frontail: stream your logs to the browser](https://raw.githubusercontent.com/hbenali/frontail/master/docs/banner.png)

# frontail

**frontail** streams log files to the browser, `tail -F` with a UI. Point it at files, stdin, Docker/Podman containers, the systemd journal or remote files over SSH, and watch lines appear in real time, colorized by log format.

![frontail in action](https://raw.githubusercontent.com/hbenali/frontail/master/docs/demo.gif)

This is a fork of [mthenw/frontail](https://github.com/mthenw/frontail), maintained by [@hbenali](https://github.com/hbenali). **[Live demo](https://frontail.hbenali.ovh/)**

```bash
npm i -g @hbenali/frontail
frontail /var/log/syslog          # or: frontail --journal
# open http://127.0.0.1:9001
```

## Where to go next

| I want to… | Page |
| --- | --- |
| Install it (npm, Docker, binaries) | [Installation](Installation) |
| See every command-line option | [Command-line options](Command-line-options) |
| Tail files, stdin, containers, the journal or remote files | [Log sources](Log-sources) |
| Keep my options in a file | [Configuration file](Configuration-file) |
| Know which log formats get colored | [Log formats](Log-formats) |
| Color my own log format | [Custom format rules](Custom-format-rules) |
| Use filters, highlights, shortcuts, downloads | [Web UI guide](Web-UI-guide) |
| Run it safely (auth, HTTPS, origins) | [Security](Security) |
| Run it in Docker, Compose or Kubernetes | [Docker and Kubernetes](Docker-and-Kubernetes) |
| Put it behind nginx or another proxy | [Reverse proxy](Reverse-proxy) |
| Monitor it (health check, Prometheus) | [Metrics and health](Metrics-and-health) |
| Fix "no logs show up" and other problems | [Troubleshooting](Troubleshooting) |
| Contribute or cut a release | [Contributing](Contributing) |

> These pages are generated from [`docs/wiki`](https://github.com/hbenali/frontail/tree/master/docs/wiki) in the repository. To change them, open a pull request there; edits made in the wiki itself are overwritten.
