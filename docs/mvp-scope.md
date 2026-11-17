# MVP scope — disabling services without removing code

> Moved out of the root [CLAUDE.md](../CLAUDE.md) to keep it under the 40k-char limit. Grep `[MVP-off]` to find every toggle.

The platform ships a trimmed **MVP scope**: **Core governance** (registry,
compliance, overview, users/IAM, admin, shell + Postgres/Keycloak/OpenFGA/MinIO),
the **RAG indexing backend** (document-indexing, embedding-service), and
the **Audit** trail (audit backend/frontend + audit-flush-worker + ClickHouse).
**Disabled** for the MVP: the **AI test-bed** MFE (ai-test-bed backend/frontend +
its `testbed-seed` Job — the RAG layer it consumed, document-indexing +
embedding-service, stays enabled), **GenAI-Observability** (monitoring, alerts,
decision-trace-analyzer) and the **OTLP telemetry pipeline**
(otel-collector, otel-rmq-bridge, otel-clickhouse-consumer). Disabling the OTLP
pipeline also drops the **RabbitMQ** StatefulSet — it has no other consumer (the
OTLP pipeline is RabbitMQ's only user; the indexing worker polls Postgres, not
RabbitMQ). **ClickHouse** stays enabled because Audit reads and writes it
(monitoring/alerts/dta are its only other readers).

**Nothing is deleted** — every disabled component's source, Dockerfile, template
and manifest entry stays in the repo. A service is switched off by config across
the layers below; grep `[MVP-off]` to find every toggle.

| Layer | File | How it's toggled |
|---|---|---|
| Build (CI) | `docker-bake.hcl` `group "default"` | image commented out of the build list (the `target` block stays — build it ad-hoc with `docker buildx bake <name>`) |
| OCM (CI) | `.ocm/component-constructor.yaml` | `ociImage` resource commented out — **mandatory**: `ocm add componentversions` resolves the digest of every listed image, so a listed-but-unbuilt image aborts the deploy with `cannot determine digest: ... not found`. Must mirror the bake list exactly |
| Build (kind) | `k8s/scripts/build-and-load-images.sh` | `MVP_DISABLED` guard in `build()`; override with `--service <name>` |
| Deploy (MFE pairs) | `values.yaml` `components[].enabled` + `templates/components.yaml` | `enabled: false` skips rendering. Guard is `ne $c.enabled false` → absent/true still renders (existing components need no flag) |
| Deploy (infra/workers) | `values.yaml` `rabbitmq`/`otel`/`policyChecker` `.enabled` | each template wrapped in `{{- if .Values.<x>.enabled }}`. **ClickHouse and the audit-flush-worker are never gated** — Audit is always-on, so ClickHouse, the `clickhouse-migrate` Job (jobs.yaml), and `audit-flush-worker` render unconditionally |
| Seed Jobs | `templates/jobs.yaml` | a Job that reuses a disabled MFE image must be gated too, else it ImagePullBackOffs. The `testbed-seed` Job is wrapped in a `{{- if $testbedEnabled }}` that scans `components` for `ai-test-bed` with `ne .enabled false` — so flipping the `ai-test-bed` component flag toggles the seed Job with it |
| Proxy | `shell/nginx.conf` | the service's `location` blocks commented out — **mandatory**: static `proxy_pass` hostnames resolve at nginx startup, so a missing upstream stops the shell (the entry point) from starting at all. Contrast the `/api/cognee/` block, which uses `resolver` + a variable to defer resolution and tolerate absence |
| Nav | `shell/public/luigi-config.js` | the nav node object commented out; the shell-bar alerts bell injection block (linked to the removed `/home/alerts` node) is also commented out |

**Re-enabling a service:** flip its `enabled` flag(s) in `values.yaml`, un-comment its target in `docker-bake.hcl`
`group "default"`, un-comment its `ociImage` entry in `.ocm/component-constructor.yaml` (must match the bake list —
an unbuilt-but-listed image breaks `ocm add componentversions`),
remove it from the `MVP_DISABLED` array in `build-and-load-images.sh`, and un-comment its entries in
`shell/nginx.conf` and `shell/public/luigi-config.js`.
Then rebuild the image and `make build && make upgrade && make rollout`.

**OCM descriptor tracks the build list:**
- `.ocm/component-constructor.yaml` lists only the images that are actually built.
  Every `[MVP-off]` image is commented out here too, mirroring `docker-bake.hcl`.
  `ocm transfer` never pulls images (it runs without `--copy-resources`), but the
  earlier `ocm add componentversions` step **resolves the digest of every listed
  image** — so a listed-but-unbuilt image is *not* harmless: it aborts the build
  with `cannot determine digest: oci artifact ... not found`. A *missing* OCM entry
  for a *deployed* image ships broken (see "Adding a new service" in the root [CLAUDE.md](../CLAUDE.md)), so the rule is:
  an image must be in this file **iff** it is in `docker-bake.hcl` `group "default"`.
  When re-enabling a service, un-comment its entry here in the same step you
  un-comment it in `docker-bake.hcl`.

**Deliberately left untouched:**
- `tests/integration/` still exercises the enabled backends against an MVP
  deployment. The `[MVP-off]` backends (`monitoring`, `alerts`) have been
  dropped from its port-forward list and health smoke test so the suite runs
  clean against the MVP; the cross-service contract tests only ever touched
  enabled backends. It remains **not a PR gate** (see [CI test workflows](tests.md#ci-test-workflows)).
