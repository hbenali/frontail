# Kubernetes examples

Kubernetes has no equivalent of `docker.sock`, so frontail's `--container`
flag doesn't map there. The idiomatic pattern instead is a **sidecar**:
frontail runs as a second container in the same Pod as your app, tailing
a log file the app writes into a shared `emptyDir` volume.

All three manifests pull the published `hbenali/frontail:latest` image
(unlike the `test/compose` scenarios, which build from the local source
tree) — swap in a pinned tag for anything beyond quick experimentation.

| Manifest | Demonstrates |
|---|---|
| `basic-sidecar.yaml` | One app container + one frontail sidecar, single shared log file |
| `multi-container-sidecar.yaml` | Two app containers (web + worker) writing separate files into the same volume; frontail tails both as separate sources |
| `with-basic-auth.yaml` | Same as basic, but `-U`/`-P` are sourced from a Secret via a small shell wrapper instead of being hardcoded |

```bash
kubectl apply -f basic-sidecar.yaml
kubectl port-forward svc/frontail-sidecar-demo 9001:9001
# open http://localhost:9001
kubectl delete -f basic-sidecar.yaml
```

These were validated for YAML/structural correctness (`kind`s and
document counts) but not deployed to a live cluster — no `kubectl`/
`kind`/`minikube` was available in the environment they were written in.
If something doesn't apply cleanly, it's most likely a typo rather than
a design issue; please open an issue.
