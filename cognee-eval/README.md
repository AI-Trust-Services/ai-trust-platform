# cognee-eval — freeze & promote a knowledge graph to read-only prod

Curate a graph in the build instance, then ship a frozen copy to prod (read-only, never ingests).

- **Build mode** (`readOnly: false`): StatefulSet + PVC, full ingest + feedback loop.
- **Read-only mode** (`readOnly: true`): Deployment + emptyDir hydrated from a digest-pinned GHCR image; ingest/feedback routes return 404.

---

## Phase 1 — Export

Run on the build instance when ingest is idle:

```bash
kubectl exec -n ai-trust cognee-eval-backend-0 -c cognee-eval-backend -- \
  tar czf - -C /app/.cognee_system --exclude=./cognee_eval.db . > /tmp/graph.tar.gz

tar tzf /tmp/graph.tar.gz | grep -c cognee_eval.db   # must be 0
```

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
