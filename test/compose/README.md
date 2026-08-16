# Docker Compose test scenarios

Each subdirectory is a self-contained scenario exercising one feature or
deployment shape, runnable on its own with:

```bash
cd test/compose/<scenario>
docker compose up --build
# open http://localhost:9001 (or whatever port the scenario prints below)
# Ctrl+C, then:
docker compose down
```

They all build from the repo's own `Dockerfile` (or `Dockerfile.demo`), so
they test whatever is currently checked out — not a published image. Only
one scenario should run at a time (they all use port 9001 by default,
except `reverse-proxy` which uses 8080).

| Scenario | What it exercises | Verify |
|---|---|---|
| `basic` | Single file, all defaults | Log lines appear, colorized |
| `multi-source` | Multiple files as separate sources | Two source pills + "All" |
| `stdin` | `frontail -` (stdin mode) | Source shows as "stdin" |
| `colors-preset` | `--ui-colors-preset` | `traceId=...` colored by the custom rule, on top of the built-in log4j rule |
| `highlight-preset` | `--ui-highlight` (default preset) | "err" highlighted red, its lines bold |
| `basic-auth` | `-U`/`-P` | No/wrong credentials → 401, right credentials → 200 |
| `containers` | `--container` (Docker) | A "chatty" companion container's logs stream in |
| `containers-podman` | `--container-engine podman` | Same, via a mounted Podman socket — see prerequisites in that scenario's compose file |
| `mixed-files-and-containers` | A file + a container together | Both appear as separate source pills |
| `url-path` | `--url-path /logs` | `/` → 404, `/logs/` → the app |
| `reverse-proxy` | Real nginx in front, under a path prefix | `http://localhost:8080/frontail` → the app (WebSocket upgrades correctly), `http://localhost:8080/` → nginx 404 |
| `json-logs` | Structured JSON-lines logs | Rendered as colorized `key=value`; an invalid-JSON line falls back gracefully |
| `ansi-colors` | A source that already emits ANSI codes | "ANSI colors" badge + "Sanitized" download appear |
| `demo-image` | The actual public-demo image (`Dockerfile.demo`) | 9 sources, all self-seeding and growing on their own — same as `frontail.hbenali.ovh` |

All scenarios except `containers-podman` and `demo-image` were run and
verified end-to-end (HTTP checks and/or visual checks in a real browser)
while writing them. `containers-podman` requires a Podman socket on the
host and was only validated for config/YAML correctness. `demo-image`
was verified separately when the demo was built.
