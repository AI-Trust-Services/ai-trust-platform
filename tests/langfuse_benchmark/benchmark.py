"""Benchmark the AI Trust Platform classifier against known ground truth, in Langfuse.

On demand (via the ``langfuse-test`` PR label, see
``.github/workflows/langfuse-benchmark.yml``) this:

1. logs into a deployed namespace over OIDC (``auth.login``),
2. **batch-imports** the ground-truth scenarios into the platform via
   ``POST /api/registry/v1/intake/batch`` (one multipart call; needs
   ``ENABLE_BATCH_IMPORT=true`` on the namespace — wired in ``k8s/env/ai-trust-test/.env``),
3. **classifies** every scenario through ``POST /api/registry/v1/classify/evaluate``
   (side-effect-free; "mock" vs real LLM is whatever the namespace's ``THALAMUS_BASE_URL``
   selects — we call it as-is),
4. loads the whole run into Langfuse as a dataset + experiment, scoring predicted tier
   vs the baseline (the scenarios file's ``ground_truth_risk_tier``) so accuracy /
   precision / recall / F1 show up per tier under Datasets -> <name> -> Runs.

Scoring logic mirrors ``experiments/classify_trust_systems.py`` from the
``ai-testing-pipeline`` reference. The classifier can emit six tiers (incl. ``gpai-*``);
ground truth only uses four, but a prediction may be ``gpai-*``, so RISK_TIERS covers all
six and such a prediction scores as a mismatch rather than crashing the evaluators.

Run locally against kind (:8080):
    APP_URL=http://localhost:8080 APP_ADMIN_PASSWORD=... \
    LANGFUSE_HOST=... LANGFUSE_PUBLIC_KEY=... LANGFUSE_SECRET_KEY=... \
        python tests/langfuse_benchmark/benchmark.py --limit 20

Offline self-test of the pure logic (no network, no Langfuse):
    python tests/langfuse_benchmark/benchmark.py --self-check
"""

from __future__ import annotations

import json
import os
from datetime import UTC, datetime
from pathlib import Path

import click
import httpx
from auth import login

# Least -> most restrictive. The scenarios file's ground truth only uses four of these,
# but classify() can return gpai-standard / gpai-systemic, so the evaluators must know
# all six to score (not crash on) such a prediction.
RISK_TIERS = [
    "minimal",
    "limited",
    "gpai-standard",
    "gpai-systemic",
    "high",
    "prohibited",
]

TRUTH_KEY = "ground_truth_risk_tier"
DEFAULT_DATA = Path(__file__).resolve().parent / "scenarios_import.json"
DEFAULT_DATASET = "ai-trust-scenarios"

REGISTRY = "/api/registry/v1"


# --------------------------------------------------------------------------- #
# Pure data wrangling (unit-tested via --self-check; no network).
# --------------------------------------------------------------------------- #
def scenario_pairs(path: Path) -> list[dict]:
    """(name, intended_purpose, truth) triples from the scenarios JSON."""
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    return [
        {
            "name": r["name"],
            "intended_purpose": r.get("intended_purpose", ""),
            "truth": r[TRUTH_KEY],
        }
        for r in data
        if r.get("name") and r.get(TRUTH_KEY)
    ]


def tier_from_response(body: dict) -> str:
    """Pull the predicted tier out of a /classify/evaluate response (top-level `tier`)."""
    return body["tier"]


# --------------------------------------------------------------------------- #
# Evaluators (ported from the reference; see module docstring). Langfuse imports
# are deferred so --self-check and import of this module stay network/SDK-free.
# --------------------------------------------------------------------------- #
def risk_tier_match(*, input, output, expected_output, metadata=None, **kwargs):
    from langfuse import Evaluation

    pred = (output or {}).get("risk_tier")
    exp = (expected_output or {}).get("risk_tier")
    return Evaluation(
        name="risk_tier_match",
        value=1.0 if pred == exp else 0.0,
        comment=f"predicted '{pred}' vs baseline '{exp}'",
    )


def tier_distance(*, input, output, expected_output, metadata=None, **kwargs):
    from langfuse import Evaluation

    pred = (output or {}).get("risk_tier")
    exp = (expected_output or {}).get("risk_tier")
    try:
        dist = abs(RISK_TIERS.index(pred) - RISK_TIERS.index(exp))
        value = 1.0 - dist / (len(RISK_TIERS) - 1)
    except ValueError:
        value = 0.0  # unknown / missing tier -> worst score, never crashes
    return Evaluation(
        name="tier_closeness",
        value=round(value, 3),
        comment=f"ordinal closeness of '{pred}' to '{exp}' (1.0 = exact)",
    )


def multiclass_metrics(*, item_results, **kwargs):
    from langfuse import Evaluation
    from sklearn.metrics import classification_report

    y_true, y_pred = [], []
    for r in item_results:
        exp = (
            r.item.expected_output
            if hasattr(r.item, "expected_output")
            else (r.item or {}).get("expected_output")
        )
        out = r.output or {}
        true_tier = (exp or {}).get("risk_tier")
        pred_tier = out.get("risk_tier")
        # Keep every ground-truth label. A failed classification (pred None) is a miss,
        # not a dropped row — otherwise failures would silently inflate the metrics.
        # The sentinel is outside RISK_TIERS, so it can never match a label and always
        # scores as a mismatch.
        if true_tier:
            y_true.append(true_tier)
            y_pred.append(pred_tier or "__classification_failed__")

    if not y_true:
        return []

    report = classification_report(
        y_true, y_pred, labels=RISK_TIERS, output_dict=True, zero_division=0
    )
    # Compute accuracy directly: classification_report omits the "accuracy" key when the
    # predictions contain values outside `labels` (e.g. the failure sentinel).
    accuracy = sum(t == p for t, p in zip(y_true, y_pred)) / len(y_true)
    evals = [Evaluation(name="accuracy", value=round(accuracy, 4))]
    for tier in RISK_TIERS:
        stats = report.get(tier, {})
        evals += [
            Evaluation(
                name=f"precision_{tier}", value=round(stats.get("precision", 0.0), 4)
            ),
            Evaluation(name=f"recall_{tier}", value=round(stats.get("recall", 0.0), 4)),
            Evaluation(name=f"f1_{tier}", value=round(stats.get("f1-score", 0.0), 4)),
        ]
    macro = report.get("macro avg", {})
    evals += [
        Evaluation(name="macro_precision", value=round(macro.get("precision", 0.0), 4)),
        Evaluation(name="macro_recall", value=round(macro.get("recall", 0.0), 4)),
        Evaluation(name="macro_f1", value=round(macro.get("f1-score", 0.0), 4)),
    ]
    return evals


# --------------------------------------------------------------------------- #
# Platform HTTP.
# --------------------------------------------------------------------------- #
def _client(app_url: str, cookies: dict[str, str]) -> httpx.Client:
    return httpx.Client(base_url=app_url.rstrip("/"), cookies=cookies, timeout=120)


def batch_import(client: httpx.Client, data_path: Path) -> dict:
    """POST the scenarios file to /intake/batch. Returns the ImportResult body.

    The scenarios' extra `ground_truth_risk_tier` key is ignored by AISystemImport
    (model_config extra="ignore"), so the file uploads as-is. Insert-only (no dedup).
    """
    with open(data_path, "rb") as fh:
        resp = client.post(
            f"{REGISTRY}/intake/batch",
            files={"file": ("scenarios_import.json", fh, "application/json")},
            data={"target_status": "draft"},
        )
    if resp.status_code == 404:
        raise SystemExit(
            "POST /intake/batch returned 404 — ENABLE_BATCH_IMPORT is not true on this "
            "namespace. Deploy with ENABLE_BATCH_IMPORT=true (see k8s/env/ai-trust-test/.env)."
        )
    resp.raise_for_status()
    return resp.json()


def classify(client: httpx.Client, name: str, intended_purpose: str) -> str:
    resp = client.post(
        f"{REGISTRY}/classify/evaluate",
        json={
            "answers": {
                "business": {"name": name, "intended_purpose": intended_purpose},
                "technical": {},
            }
        },
    )
    resp.raise_for_status()
    return tier_from_response(resp.json())


# --------------------------------------------------------------------------- #
# CLI
# --------------------------------------------------------------------------- #
@click.command()
@click.option(
    "--data",
    type=click.Path(path_type=Path),
    default=DEFAULT_DATA,
    show_default=True,
    help="Ground-truth scenarios JSON (with ground_truth_risk_tier).",
)
@click.option(
    "--limit",
    type=int,
    default=lambda: int(os.getenv("BENCH_LIMIT", "0")) or None,
    help="Max scenarios to run (default: all). Env: BENCH_LIMIT.",
)
@click.option(
    "--dataset",
    default=lambda: os.getenv("DATASET_NAME", DEFAULT_DATASET),
    help="Langfuse dataset name. Env: DATASET_NAME.",
)
@click.option(
    "--skip-import",
    is_flag=True,
    help="Skip the batch import step (classify against already-present systems).",
)
@click.option(
    "--self-check", is_flag=True, help="Offline self-test of the pure logic, then exit."
)
def main(
    data: Path,
    limit: int | None,
    dataset: str,
    skip_import: bool,
    self_check: bool,
) -> None:
    if self_check:
        return _self_check()

    app_url = os.environ.get("APP_URL", "http://localhost:8080")
    # The benchmark user needs systems:write (/intake/batch) + systems:read
    # (/classify/evaluate). The platform admin only has iam:manage, so default to
    # dev-engineer (ai_engineer role), seeded on dev/test clusters.
    bench_user = os.environ.get("BENCH_USERNAME", "dev-engineer")
    bench_pass = os.environ.get("BENCH_PASSWORD")
    if not bench_pass:
        raise SystemExit("BENCH_PASSWORD must be set.")
    for var in ("LANGFUSE_HOST", "LANGFUSE_PUBLIC_KEY", "LANGFUSE_SECRET_KEY"):
        if not os.environ.get(var):
            raise SystemExit(f"{var} must be set (push target for the benchmark).")

    pairs = scenario_pairs(data)
    if limit:
        pairs = pairs[:limit]
    if not pairs:
        raise SystemExit("No scenarios with ground truth found.")

    click.echo(f"Logging in as '{bench_user}' at {app_url} ...")
    cookies = login(app_url, bench_user, bench_pass)

    with _client(app_url, cookies) as client:
        # 1. Batch import (idempotent by design is NOT guaranteed — insert-only, so run once).
        if not skip_import:
            result = batch_import(client, data)
            click.echo(
                f"Batch import: {result.get('imported', 0)} imported, "
                f"{len(result.get('failed', []))} failed"
            )
            if not result.get("imported"):
                raise SystemExit("Batch import inserted 0 records — aborting.")

        # 2. One classify call per scenario (the expensive part).
        preds: dict[str, str | None] = {}
        failed = 0
        with click.progressbar(
            pairs, label=f"Classifying {len(pairs)} scenarios"
        ) as bar:
            for p in bar:
                try:
                    preds[p["name"]] = classify(
                        client, p["name"], p["intended_purpose"]
                    )
                except httpx.HTTPError:
                    preds[p["name"]] = None  # counts as a miss in scoring
                    failed += 1
        if failed:
            click.echo(f"warn: {failed} classifications failed (counted as a miss)")

    # 3. Seed the Langfuse dataset (idempotent via name-as-id) and run the experiment.
    # get_client() reads LANGFUSE_TRACING_ENVIRONMENT automatically, so the experiment's
    # traces are tagged with the deploy namespace and are filterable by environment in
    # Langfuse alongside the platform's own traces from this namespace.
    from langfuse import get_client

    environment = (
        os.environ.get("LANGFUSE_TRACING_ENVIRONMENT", "").strip() or "default"
    )
    langfuse = get_client()
    if not langfuse.auth_check():
        raise SystemExit(f"Langfuse auth failed for {os.environ['LANGFUSE_HOST']}.")
    click.echo(f"Langfuse environment: {environment}")

    langfuse.create_dataset(
        name=dataset,
        description="AI Trust Platform EU AI Act classification benchmark vs ground truth.",
    )
    for p in pairs:
        langfuse.create_dataset_item(
            dataset_name=dataset,
            id=p["name"],
            input={"name": p["name"], "intended_purpose": p["intended_purpose"]},
            expected_output={"risk_tier": p["truth"]},
        )

    async def task(*, item, **kwargs) -> dict:
        name = (item.input or {}).get("name")
        return {"risk_tier": preds.get(name)}

    ts = datetime.now(UTC).strftime("%Y%m%d-%H%M%S")
    experiment = langfuse.get_dataset(dataset).run_experiment(
        name=f"benchmark-{ts}",
        description="AI Trust Platform classifier vs ground truth.",
        task=task,
        evaluators=[risk_tier_match, tier_distance],
        run_evaluators=[multiclass_metrics],
    )
    print(experiment.format())
    langfuse.flush()
    print(f"\nView: {os.environ['LANGFUSE_HOST'].rstrip('/')}/")


def _self_check() -> None:
    # tier_from_response pulls the top-level tier.
    assert tier_from_response({"tier": "high", "basis": "..."}) == "high"

    # scenario_pairs keeps only records with both name and ground truth.
    import tempfile

    sample = [
        {"name": "a", "intended_purpose": "x", TRUTH_KEY: "high"},
        {"name": "b", "intended_purpose": "y"},  # no truth -> dropped
        {"intended_purpose": "z", TRUTH_KEY: "minimal"},  # no name -> dropped
    ]
    with tempfile.NamedTemporaryFile(
        "w", suffix=".json", delete=False, encoding="utf-8"
    ) as fh:
        json.dump(sample, fh)
        tmp = Path(fh.name)
    pairs = scenario_pairs(tmp)
    tmp.unlink()
    assert [p["name"] for p in pairs] == ["a"], pairs

    # RISK_TIERS ordering is self-consistent and covers the 4 ground-truth tiers.
    for t in ("minimal", "limited", "high", "prohibited"):
        assert t in RISK_TIERS, t
    assert RISK_TIERS.index("minimal") < RISK_TIERS.index("prohibited")

    print("self-check ok")


if __name__ == "__main__":
    main()
