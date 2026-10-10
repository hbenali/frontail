# Metrics and health

## Health check

`GET /healthz` always returns `200 OK`, regardless of `--url-path`, and never needs credentials. Use it for container, load-balancer and Kubernetes probes.

## Prometheus metrics

Off by default. Enable with `--metrics`; the endpoint is `<url-path>/metrics`, behind Basic Auth when `-U`/`-P` are set.

| Metric | Type | Meaning |
| --- | --- | --- |
| `frontail_build_info{version}` | gauge | always 1 |
| `frontail_uptime_seconds` | gauge | seconds since start |
| `frontail_connected_clients` | gauge | browsers on the log socket |
| `frontail_sources` | gauge | files, containers, journal and ssh sources |
| `frontail_lines_total{source}` | counter | lines read, per source |
| `frontail_tail_errors_total` | counter | errors from tail, the container engine, journalctl or ssh |

```yaml
scrape_configs:
  - job_name: frontail
    static_configs:
      - targets: ['frontail:9001']
    # basic_auth:
    #   username: admin
    #   password_file: /etc/prometheus/frontail_password
```

Useful alerts: `rate(frontail_tail_errors_total[5m]) > 0` (a source is failing), or `rate(frontail_lines_total[5m]) == 0` for a source that should always be busy.
