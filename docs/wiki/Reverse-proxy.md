# Reverse proxy

## nginx

Serve frontail under a path prefix and pass WebSocket upgrades through:

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

Start frontail with `--url-path /frontail` (and `-h 127.0.0.1`).

A containerized version of exactly this setup (nginx + frontail in Compose, path prefix included) is in [`test/compose/reverse-proxy`](https://github.com/hbenali/frontail/tree/master/test/compose/reverse-proxy): `docker compose up --build`, then open `http://localhost:8080/frontail`.

## Checklist

- **WebSocket**: the proxy must forward `Upgrade` and `Connection` headers (above). Without them the page loads but stays empty.
- **`Host` header**: frontail only lets browsers open the log socket from the page's own host. If the proxy rewrites `Host` (nginx's default sends the upstream's address), either keep the original with `proxy_set_header Host $host;` or allow the public address with `--allowed-origin https://logs.example.com`.
- **TLS**: terminate it at the proxy and bind frontail to loopback.
- **Auth**: Basic Auth works through a proxy (`-U` / `--password-file`), or authenticate at the proxy. `/healthz` is always unauthenticated.
- **Timeouts**: raise `proxy_read_timeout` (nginx defaults to 60 s) so idle log streams aren't cut.
