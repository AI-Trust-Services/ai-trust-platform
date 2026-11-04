# cognee-eval — freeze & promote a knowledge graph to read-only prod

Graph ingestion **always happens in ai-test-lab** (Docker Compose, separate repo).
ai-trust-platform always runs with `cogneeEval.readOnly: true`, pulling a frozen snapshot from GHCR.

- **ai-test-lab** (`readOnly: false` equivalent): Docker Compose, full ingest + feedback loop, owns the live graph.
- **Read-only mode** (`readOnly: true`): Deployment + emptyDir hydrated from a digest-pinned GHCR image; ingest/feedback routes return 404.

---

## Gardener deploys (`ai-trust-main` / `ai-trust-test`) — automatic mirror from ai-test-lab

ai-test-lab now publishes promoted `cognee-graph` snapshots directly to its own package,
`ghcr.io/ai-trust-services/ai-test-lab/cognee-graph`. ai-trust-platform's workflows are
granted read access to that package, so there is no manual export/build/push for these
two clusters anymore — only a tag pointer to set:

1. An operator sets `COGNEE_GRAPH_TAG=<tag>` in `k8s/env/ai-trust-main/.env` or
   `k8s/env/ai-trust-test/.env` to whatever tag ai-test-lab just published (e.g.
   `eu-ai-act-20261104`).
2. On the next run of `build-push-deploy.yml`, the `mirror-cognee-graph` composite
   action pulls that tag from ai-test-lab's package, re-pushes it into
   `ghcr.io/<owner>/ai-trust-platform/cognee-graph` (so the existing read-only init
   container and pull secrets keep working unchanged), and emits the resulting
   `@sha256`-pinned digest.
3. That digest is threaded into the `ai-trust-flux-values-<namespace>` Secret as
   `COGNEE_GRAPH_IMAGE` (see `k8s/scripts/bootstrap.sh`) and mapped by Flux
   `valuesFrom` onto `cogneeEval.graphImage` (see `k8s/ocm/manifests.yaml`) — no chart
   commit required.
4. If `COGNEE_GRAPH_TAG` is blank/unset, the mirror step is skipped and Flux falls back
   to the chart's committed `cogneeEval.graphImage` default (the `valuesFrom` entry is
   `optional: true`).

This mirror flow is additive: the manual Phase 1–3 promotion flow below still works
(e.g. for local kind, or any cluster not wired into the Flux `valuesFrom` mechanism) and
remains the way `values.yaml` / `values-kind.yaml` defaults get updated.

## Phase 1 — Export from ai-test-lab

Export from the running ai-test-lab `cognee-eval-backend` container when ingest is idle (never restart it — that wipes the graph):

```bash
docker exec cognee \
  tar czf - -C /cognee-storage --exclude=./data . > /tmp/graph.tar.gz

tar tzf /tmp/graph.tar.gz | grep -c cognee_eval.db   # must be 0
```

> **Container name**: the ai-test-lab cognee container is `cognee` (from `cognee/cognee:1.6.5`).
> Data lives at `/cognee-storage/system` (graph + vectors) and `/cognee-storage/data` (raw text chunks — excluded from the snapshot, not needed for read-only serving).
> The `tar: file changed as we read it` warning from LanceDB WAL files is harmless — the archive is valid.

> **Do not export from ai-trust-platform** — the platform's pod runs read-only with an emptyDir hydrated from GHCR. Exporting from it would snapshot the hydrated copy, not the curated source.
>
> **Do not restart the ai-test-lab container** — cognee recreates empty per-dataset stub files on startup, overwriting the real graph data.

## Phase 2 — Promote to GHCR

Publish as a **pre-release** (not a draft):

```bash
gh release create cognee-graph-$(date +%Y%m%d) --prerelease \
  --title "cognee graph $(date +%F)" /tmp/graph.tar.gz
```

Run the promotion workflow — builds a multi-arch image, pushes to GHCR, prints the digest:

```bash
gh workflow run promote-graph.yml \
  -f release_tag=cognee-graph-$(date +%Y%m%d) \
  -f graph_tag=eu-ai-act-$(date +%Y%m%d) \
  -f source_doc_sha256=$(sha256sum /tmp/graph.tar.gz | cut -d' ' -f1)

gh run watch
```

Copy `cognee-graph@sha256:<digest>` from the run summary.

## Phase 3 — Deploy

Update `graphImage` in `values-kind.yaml` (or the prod values override) with the new digest:

```yaml
cogneeEval:
  readOnly: true
  graphImage: ghcr.io/<owner>/ai-trust-platform/cognee-graph@sha256:<digest>
```

Then: `make upgrade && make rollout`.

---

## Notes

- **GHCR auth**: on kind, set `GHCR_PULL_TOKEN=<PAT with read:packages>` in `.env` — `bootstrap.sh` creates the pull secret automatically. On Gardener the deploy workflow handles it.
- **Promotion is manual by design** — a human blesses the graph before it ships to prod.
- **Feedback merges into the main graph** — the snapshot carries source doc + all approved feedback as one coherent graph.
