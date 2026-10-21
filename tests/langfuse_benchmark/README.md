# Langfuse classification benchmark

On-demand benchmark of the AI Trust Platform's EU AI Act classifier against a
known-ground-truth dataset, with results visualised in **Langfuse** (dataset +
experiment run, scored per risk tier).

## What it does

1. **Logs in** to a deployed namespace over OIDC through oauth2-proxy (`auth.login` —
   the same real-login flow `tests/e2e_system/` uses, no `X-Forwarded-*` bypass).
2. **Batch-imports** `scenarios_import.json` (339 ground-truth scenarios) via
   `POST /api/registry/v1/intake/batch` — one multipart call. Requires
   `ENABLE_BATCH_IMPORT=true` on the namespace (wired into `k8s/env/ai-trust-test/.env`;
   see the root `CLAUDE.md`). If the flag is off the endpoint 404s and the script aborts
   with a clear message.
3. **Classifies** every scenario through `POST /api/registry/v1/classify/evaluate`
   (side-effect-free). Whether this runs the real Thalamus LLM or the offline stub is
   decided by the namespace's `THALAMUS_BASE_URL` — the script calls it as-is.
4. **Pushes to Langfuse**: creates/updates the `ai-trust-scenarios` dataset (one item per
   scenario, `expected_output` = the scenario's `ground_truth_risk_tier`) and runs an
   experiment that scores the predictions. Evaluators: `risk_tier_match` (exact),
   `tier_closeness` (ordinal distance), and run-level `multiclass_metrics`
   (accuracy + per-tier precision/recall/F1 + macro averages, via scikit-learn).

The classifier can emit six tiers (`minimal`, `limited`, `gpai-standard`, `gpai-systemic`,
`high`, `prohibited`); the scenarios' ground truth uses only four, but a prediction may be
`gpai-*`, so `RISK_TIERS` covers all six and such a prediction is scored as a mismatch
rather than crashing the ordinal/sklearn evaluators.

## Files

| File | Purpose |
|---|---|
| `benchmark.py` | The script (`click` CLI). Import → classify → score → Langfuse. |
| `auth.py` | OIDC login + stdlib HTML form parsing (lifted from `tests/e2e_system/conftest.py`). |
| `scenarios_import.json` | 339 ground-truth scenarios (`name`, `org_role`, `intended_purpose`, `ground_truth_risk_tier`). |
| `requirements.txt` | `httpx`, `click`, `langfuse==5.0.3` (matches backend), `scikit-learn`. |

## Run it

### CI (the normal path)

Add the **`langfuse-test`** label to a PR (after `garden-deploy` has deployed the PR
author's namespace). `.github/workflows/langfuse-benchmark.yml` runs this script against
`https://<github-username>.ai-trust-test…` and comments the result on the PR.

### Locally against kind (`:8080`)

```bash
pip install -r tests/langfuse_benchmark/requirements.txt

# needs ENABLE_BATCH_IMPORT=true on the registry backend:
#   set it in .env, then: make upgrade && make rollout
APP_URL=http://localhost:8080 \
BENCH_USERNAME=dev-engineer BENCH_PASSWORD=<dev-user-pass> \
LANGFUSE_HOST=<url> LANGFUSE_PUBLIC_KEY=<pk> LANGFUSE_SECRET_KEY=<sk> \
    python tests/langfuse_benchmark/benchmark.py --limit 20
```

### Offline self-test (no network, no Langfuse)

```bash
python tests/langfuse_benchmark/benchmark.py --self-check
```

## Options / env

| Flag | Env | Default | Meaning |
|---|---|---|---|
| `--limit` | `BENCH_LIMIT` | all 339 | Cap the number of scenarios. |
| `--dataset` | `DATASET_NAME` | `ai-trust-scenarios` | Langfuse dataset name. |
| `--skip-import` | — | off | Classify against systems already in the namespace (no import). |
| `--data` | — | `scenarios_import.json` | Alternative ground-truth file. |
| `--self-check` | — | off | Run the offline logic self-test and exit. |
| — | `APP_URL` | `http://localhost:8080` | Platform entry point (oauth2-proxy). |
| — | `BENCH_USERNAME` / `BENCH_PASSWORD` | `dev-engineer` / — | Benchmark login. Needs `systems:write` + `systems:read` — the `ai_engineer` role has both; the platform admin (`iam:manage` only) does **not**. |
| — | `LANGFUSE_HOST` / `LANGFUSE_PUBLIC_KEY` / `LANGFUSE_SECRET_KEY` | — | Langfuse push target (required). |

> **Note** — batch import is insert-only (no dedup); each run inserts a fresh copy of the
> scenarios. The Langfuse dataset is keyed by scenario `name`, so dataset items are
> idempotent across runs even though the imported systems are not.
