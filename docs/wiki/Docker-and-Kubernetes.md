# Docker and Kubernetes

## Images

Released images are built by CI (multi-arch, amd64 and arm64) and published to Docker Hub and GHCR on every version tag:

```bash
docker pull hbenali/frontail:latest
docker pull ghcr.io/hbenali/frontail:latest
```

The image is a multi-stage build on Node 24 LTS / Alpine, runs as a non-root `frontail` user, and includes `docker-cli` for container streaming.

## Running

```bash
# Files
docker run -d -p 9001:9001 -v /var/log:/log:ro hbenali/frontail /log/syslog

# Files + container streaming (mount the Docker socket)
docker run -d -p 9001:9001 \
  -v /var/log:/log:ro \
  -v /var/run/docker.sock:/var/run/docker.sock:ro \
  hbenali/frontail /log/syslog --container myapp

# A custom colorizing preset
docker run -d -p 9001:9001 -v /var/log:/log:ro \
  -v ./my-colors.json:/frontail/preset/my-colors.json:ro \
  hbenali/frontail /log/syslog --ui-colors-preset /frontail/preset/my-colors.json
```

The entrypoint adds the `frontail` user to the socket's group at startup when `docker.sock` is mounted.

> **Permission denied on a log file?** The container runs as a non-root user. If the file on the host is readable only by root, frontail shows `[frontail] /log/...: cannot open ... Permission denied` in the log view. Make the file group-readable, or see [Troubleshooting](Troubleshooting).

## Docker Compose

```yaml
services:
  frontail:
    image: hbenali/frontail:latest
    command: --container myapp /logs/syslog
    ports: ["9001:9001"]
    volumes:
      - /var/log:/logs:ro
      - /var/run/docker.sock:/var/run/docker.sock:ro
```

Worked examples (basic, multi-source, auth, containers with Docker or Podman, colors and highlight presets, JSON logs, stdin, url-path, a real nginx reverse proxy) are in [`test/compose`](https://github.com/hbenali/frontail/tree/master/test/compose).

## Secrets

```yaml
    environment:
      FRONTAIL_USER: admin
    command: --password-file /run/secrets/frontail_password /logs/app.log
    secrets: [frontail_password]
```

## Kubernetes

Kubernetes has no `docker.sock` equivalent, so `--container` doesn't apply. Run frontail as a **sidecar** in the same Pod, sharing an `emptyDir` volume the app writes its log file into:

```bash
kubectl apply -f https://raw.githubusercontent.com/hbenali/frontail/master/test/k8s/basic-sidecar.yaml
kubectl port-forward svc/frontail-sidecar-demo 9001:9001
```

Manifests for a basic sidecar, multi-container sidecars and Basic Auth are in [`test/k8s`](https://github.com/hbenali/frontail/tree/master/test/k8s).

## Health check

The image has a built-in `HEALTHCHECK` on a fixed `/healthz` endpoint, always `200 OK`, independent of `--url-path` and never requiring Basic Auth, so it works with `docker ps`, Compose, Swarm and Kubernetes probes:

```yaml
healthcheck:
  test: ["CMD", "curl", "-fsS", "http://127.0.0.1:9001/healthz"]
  interval: 30s
  timeout: 5s
  retries: 3
```

The image is Alpine-based (no `/bin/bash`), so a `CMD-SHELL` check relying on bash's `/dev/tcp` fails; use `curl` against `/healthz`.

## Building

```bash
docker build -t hbenali/frontail .
```
