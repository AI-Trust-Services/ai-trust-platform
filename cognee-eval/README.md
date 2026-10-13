# cognee-eval — freeze & promote a knowledge graph to read-only prod

Build/curate a graph in the test instance, then ship a frozen copy to a
read-only production that only serves (never ingests).

**Build mode** (`cogneeEval.readOnly: false`): StatefulSet + PVC, full ingest +
feedback loop. **Read-only mode** (`readOnly: true`): Deployment + emptyDir
hydrated from a digest-pinned GHCR image; ingest/feedback routes return 404.

---

## Phase 1 — Export the approved graph

Run against the test instance (operator kubeconfig). Export only when ingest is idle.

```bash
kubectl exec -n ai-trust cognee-eval-backend-0 -c cognee-eval-backend -- \
  tar czf - -C /app/.cognee_system --exclude=./cognee_eval.db . > /tmp/graph.tar.gz

tar tzf /tmp/graph.tar.gz | grep -c cognee_eval.db   # must be 0 (no PII)
```

## Phase 2 — Promote to GHCR

Publish the tarball as a **pre-release** (not a draft — a draft 404s the workflow token):

```bash
gh release create cognee-graph-$(date +%Y%m%d) --prerelease \
  --title "cognee graph $(date +%F)" /tmp/graph.tar.gz
```

Run the promotion workflow (builds a multi-arch image + provenance manifest, pushes to GHCR):

```bash
gh workflow run promote-graph.yml \
  -f release_tag=cognee-graph-$(date +%Y%m%d) \
  -f graph_tag=eu-ai-act-$(date +%Y%m%d) \
  -f source_doc_sha256=$(sha256sum /tmp/graph.tar.gz | cut -d' ' -f1)

gh run watch
```

Copy the printed `cognee-graph@sha256:<digest>` from the run summary.

## Phase 3 — Deploy read-only

Pin the digest and enable read-only in your values override:

```yaml
cogneeEval:
  readOnly: true
  graphImage: ghcr.io/<owner>/ai-trust-platform/cognee-graph@sha256:<digest>
```

Deploy (`make upgrade && make rollout`, or the Gardener workflow). Verify:

```bash
kubectl get deploy cognee-eval-backend -n ai-trust      # Deployment, not StatefulSet
curl -s .../api/cognee/health                           # {"status":"ok"}
curl -s .../api/cognee/v1/graph/raw                      # the frozen graph
curl -s -o /dev/null -w '%{http_code}' -X POST .../api/cognee/v1/ingest   # 404
```

The init container pulls the image once at startup and extracts it into the
emptyDir. On a bad/empty snapshot, `/health` returns 503 and the pod stays
NotReady — a bad graph never serves.

---

## Notes

- **GHCR auth**: the graph image is private. On **kind** the pull secret is created
  automatically by `bootstrap.sh` — set `GHCR_PULL_TOKEN=<PAT with read:packages>` in
  `.env` before running `make bootstrap` (or `make up`). On **Gardener** the deploy
  workflow creates `ghcr-pull-secret` from the CI `GHCR_PULL_TOKEN` secret. Both
  environments use the same secret name (`ghcr-pull-secret`) wired in `values-kind.yaml`
  via `imagePullSecrets`.
- **Promotion is manual by design** — a human blesses the graph. The workflow
  trigger (`workflow_dispatch`) must be on `main` to be runnable.
- **Feedback** is merged into the main graph (one dataset / one `.pkl`), so the
  snapshot carries the source doc + all approved feedback as one coherent graph.
