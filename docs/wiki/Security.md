# Security

frontail shows whatever it is pointed at, so treat access to it like access to those logs.

## Authentication

```bash
frontail -U admin --password-file /run/secrets/frontail_password /var/log/syslog
```

- **Don't use `-P` on shared machines**: command-line arguments are visible to every local user through `ps`. Use `--password-file`, or the `FRONTAIL_USER` / `FRONTAIL_PASSWORD` environment variables.
- Daemon mode passes credentials to the background process through its environment, never through arguments.
- Credentials are compared in constant time.
- The log stream's WebSocket requires the authenticated session as well as the page.

## HTTPS

Basic Auth sends credentials in clear text. Either serve HTTPS directly:

```bash
frontail -k key.pem -c cert.pem /var/log/syslog
```

or terminate TLS in a [reverse proxy](Reverse-proxy) and bind frontail to loopback (`-h 127.0.0.1`).

## Cross-site protection (Origin check)

Browsers always send an `Origin` header when opening a WebSocket and pages cannot forge it. frontail only accepts a browser connection whose origin has the **same host** as the request, so a malicious page on another site can't read your logs through your browser. Clients that send no `Origin` (curl, scripts) are not browser-driven and aren't affected.

If a reverse proxy rewrites the `Host` header, the log view will stay empty. Allow the public address:

```bash
frontail --allowed-origin https://logs.example.com ...
```

(repeat the flag for several origins).

## Response headers

Every response carries `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy` and a **Content-Security-Policy** (`script-src 'self'`, same-origin connections, `frame-ancestors 'self'`). Google Fonts is the only external origin allowed.

## Remote sources

- `--ssh` validates the host and quotes the remote path, so a hostile value can't inject ssh options or remote commands. It uses `BatchMode=yes` and your normal ssh config and keys.
- The journal needs read access to the systemd journal; run frontail as a user in `systemd-journal` or `adm`, not as root.

## Reporting a vulnerability

Please don't open a public issue for a security problem. Email **contact@hbenali.ovh** with the details and a way to reproduce it, and you'll get a reply before anything is disclosed.
