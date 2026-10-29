# Test Strategy — AI Trust Platform MVP

## Test levels

| Repo term | Industry term | Boundary | MVP |
|---|---|---|---|
| Lint / typecheck | Static analysis | Code validation | ✅ |
| Unit | Unit | Pure logic, no I/O | ✅ |
| E2E per service | End-to-end micro service | One service in-process, other services mocked | ✅ |
| Integration | Cross-service technical integration | Technical contracts between deployed services over real HTTP: shared data, RBAC enforcement, cascades, internal calls. See [Integration scenarios](#integration-scenarios) | ✅ |
| E2E System | System / end-to-end (API level), domain | MVP business requirements: full happy-path persona flows driven black-box through the whole deployed platform; no browser or login. See [E2E system scenarios](#e2e-system-scenarios) | ✅ |
| Deployment test | Deployment verification | Helm/OCM rollout healthy, K8s liveness & readiness probes.| ✅ |
| AI output evaluation | ML evaluation | Accuracy of AI-assisted classification against a labelled dataset. See [AI output evaluation](#ai-output-evaluation) | ✅ |
| Frontend tests | Component / visual regression | React component behaviour and visual states; proposed tool: Playwright (Apache 2.0). See [Frontend tests](#frontend-tests) | ✅ |
| Performance / load | Performance | Throughput, latency, and race-condition checks under load | TBD |

**Test Coverage: measure, don't gate.** `pytest-cov` runs in report-only mode with no threshold; it never
fails a build (see [Test Code Coverage](#test-code-coverage)).

---

## Development loop

One change goes round the loop: develop → PR checks → deploy to `ai-trust-test` → live tests →
merge → deploy to `ai-trust-main` → live tests → next change. A red step sends the change back to
**Develop**.

```mermaid
flowchart LR
    DEV(["① Local<br/>development: lint · typecheck · unit · e2e · integration · E2E"])
    PR["② PR checks<br/>lint · typecheck · unit · e2e"]
    DT["③ Deploy PR<br/><b>ai-trust-test</b><br/>PR namespace"]
    LT["④ Live tests on ai-trust-test<br/>integration · E2E"]
    MG{{"⑤ Merge to main"}}
    DM["⑥ Deploy main<br/><b>ai-trust-main</b><br/>namespace ai-trust"]
    LM["⑦ Live tests on ai-trust-main<br/>integration · E2E"]

    DEV ==> PR ==> DT ==> LT ==> MG ==> DM ==> LM
    LM -- "next change" --> DEV
    PR -. "red → fix" .-> DEV
    LT -. "red → fix" .-> DEV

    classDef test fill:#e0f2fe,stroke:#0284c7,color:#0c4a6e
    classDef main fill:#d1fae5,stroke:#059669,color:#064e3b
    classDef gate fill:#fef3c7,stroke:#d97706,color:#78350f
    class DEV,PR,DT,LT test
    class DM,LM main
    class MG gate
```

## Integration scenarios

**Cross-service technical integration**: proof that deployed services work together at their technical
seams — shared data integrity, RBAC enforcement across backends, cascade side-effects, internal HTTP
calls, and platform wiring. These run in-cluster (kind or Gardener) over real HTTP. A failure points
to a broken technical contract, not a missing business requirement.

The integration tests talk directly to backend ports (via kubectl port-forward), so they never go through oauth2-proxy or Keycloak

Legend: ✅ test covered · ⬜ test missing, functionality exists

### A. Platform wiring and reachability

| Scenario | State |
|---|---|
| Health of all backends (each `/health` also checks its DB connection) | ✅ `test_01_health.py` |
| Shell entry page is served (HTTP 200, HTML) | ⬜ |
| MVP frontends (Registry, Compliance) are served through the shell proxy (HTTP 200, HTML) | ⬜ |
| MVP backend APIs (Registry, Compliance) are reachable through the shell proxy | ⬜ |

### B. Registry ↔ Compliance

| Scenario | State |
|---|---|
| Registered system is resolvable by compliance (shared FK integrity) | ✅ `test_02_registry_compliance.py` |
| Assessment creation auto-generates obligations and requirements for all tiers | ✅ `test_02_registry_compliance.py` |
| Approved evidence cascades compliance score back to `ai_systems.compliance` | ✅ `test_02_registry_compliance.py` |
| Rejected evidence reverts compliance score | ✅ `test_02_registry_compliance.py` |
| Delete assessment including dependencies (obligations, requirements) and associated risk classification on the system | ⬜ |
| Document upload → link to system → delete attempt blocked → unlink → delete succeeds | ⬜ |
| Audit flush worker — event written to Postgres buffer → flushed to ClickHouse → deleted from Postgres | ⬜ |
| Assessment submitted to CO → `workflow_status` transitions correctly through all states (`draft → pending_assessment → pending_review → approved`) | ⬜ |
| CO request-info → section re-opened → submit-info → reclassification → back to `pending_review` | ⬜ |
| Per-question assignment → contributor answers → approval gate enforced | ⬜ |

### B2. Backend contracts

Technical invariants enforced by individual backends, independent of cross-service data flow.

| Scenario | State |
|---|---|
| Document upload size cap (20 MB) rejected by the backend before reaching MinIO | ⬜ |
| Presigned MinIO URLs expire within the configured TTL and are not reusable after expiry | ⬜ |
| Audit trail is append-only — no DELETE or UPDATE path exists in the audit backend API | ⬜ |

### C. RBAC (cross-service)

These scenarios verify that role checks are enforced at the API level across service boundaries, not
just in the frontend. All 403 scenarios are tested at the API level, not the frontend.

| Scenario | State |
|---|---|
| Auditor cannot write systems (403) | ✅ `test_03_rbac.py` |
| Platform Administrator cannot read assessments (403) | ✅ `test_03_rbac.py` |
| Admin stats endpoint aggregates correctly across backends | ✅ `test_03_rbac.py` |
| AI Engineer cannot approve evidence (403) | ✅ `test_03_rbac.py` |
| AI Engineer can write systems | ⬜ |
| AI Business Owner can write systems | ⬜ |
| AI Engineer can start an assessment | ⬜ |
| AI Business Owner can start an assessment | ⬜ |
| Assignee can unassign themselves within an assessment | ⬜ |
| Person who assigned others can unassign those assignees within an assessment | ⬜ |
| Compliance Officer can forward an assessment to a different Compliance Officer | ⬜ |
| Compliance Officer can send an assessment back to the responsible person to provide more information | ⬜ |
| Compliance Officer can confirm and finish an assessment | ⬜ |

---

## E2E system scenarios

**Full happy-path business flows**: proof that the MVP flow works end-to-end as the business requires
for each persona. Each scenario is a complete flow driven black-box through the whole deployed
platform. These are the MVP acceptance criteria. A failure points to an unmet business requirement.

Legend: ✅ test covered · ⬜ test missing, functionality exists

### 0. Authentication

| Scenario | State |
|---|---|
| User authenticates via Keycloak OIDC → oauth2-proxy issues a session cookie → shell is reachable through port 8080 | ⬜ |

### 1. Registration

| Scenario | State |
|---|---|
| AI Engineer registers a new system end-to-end through the shell proxy | ⬜ |
| AI-assisted registration: conversational intake and an uploaded document pre-fill the registration fields | ⬜ |

### 2. Self-assessment

| Scenario | State |
|---|---|
| Application Owner submits the business section → AI Engineer submits the technical section → system `pending_review` | ⬜ |
| Section owner delegates a question to a sub-assignee → sub-assignee answers → owner reclaims | ⬜ |

### 3. Risk classification

| Scenario | State |
|---|---|
| Full governance chain: register system → fill assessment (AI Engineer + Application Owner) → AI-based preclassification → submit to CO → CO approves → confirmed classification | ⬜ |
| Bounce-back flow: CO requests info → section reopened → owner resubmits → system reclassified → CO approves | ⬜ |

### 4. Classification confirmation

| Scenario | State |
|---|---|
| Compliance Officer approves → system `approved` (registry) and assessment `approved` (compliance); risk flags locked | ⬜ |
| Compliance Officer corrects tier and/or EU AI Act role on approval → corrected values stored | ⬜ |

### 5. Requirements — outside MVP scope (regression only)

| Scenario | State |
|---|---|
| Assessment creation generates requirements for each obligation | ✅ `test_02_registry_compliance.py` |

### 6. Evidence upload — outside MVP scope (regression only)

| Scenario | State |
|---|---|
| Evidence uploaded and linked to a requirement | ✅ `test_02_registry_compliance.py` |

### 7. Approval — outside MVP scope (regression only)

| Scenario | State |
|---|---|
| Evidence approval / rejection cascades compliance score to registry | ✅ `test_02_registry_compliance.py` |

Monitoring follows Approval in the lifecycle and is outside MVP scope; no E2E system scenarios.

---

## Frontend tests

**Proposed tool: [Playwright](https://playwright.dev/)** — Apache 2.0 licensed, runs on standard
GitHub-hosted runners without additional infrastructure, and covers both component-level interaction
and visual regression via screenshot comparison. It replaces the need for a separate Storybook +
Chromatic stack.

---

## AI output evaluation

> **To be refined.** Metrics and thresholds are not decided. Will be covered with AI Assisted functionality implementation.

Placeholder scope, to be confirmed:
- **What:** accuracy of the AI-assisted RCE: flags extracted from questionnaire answers and uploaded
  documents, and the resulting tier and EU AI Act role, against a labelled dataset covering all tiers.
- **Inputs:** labelled dataset, evaluation pipeline and test bed (planned).
- **Relation to functional tests:** integration and E2E system tests prove the workflow works with a deterministic
  stub. Evaluation proves the AI output is good enough.
- **To decide:**
  - metrics (per-tier precision/recall?) and MVP thresholds
  - confidence calibration, needed if a confidence threshold routes classifications
  - label mapping: the MVP scope uses combined classes (e.g. high risk + transparency), while the
    classifier returns a single tier and also has GPAI tiers
  - which LLM provider and model is evaluated, and whether evaluation runs in CI or on demand

---

## Test Code Coverage

**Measure, don't gate.** Coverage is reported, not enforced:

- **Tool:** `pytest-cov` (branch coverage — `--cov-branch` is required for CRAP; see below).
- **Mode:** report-only. **No threshold**, no `--cov-fail-under`, no PR or `main` gate. A low number
  never fails a build.
- **Scope:** the in-process levels: unit and per-service E2E (`tests/unit/`, `tests/e2e/`). The live
  platform levels (integration, E2E system) are black-box over HTTP and are not measured for code
  coverage; they are measured by the business and technical scenarios above.
- **Output:** a terminal summary and a JSON report per backend (`coverage.json`), uploaded as a CI
  artifact by the CRAP report workflow. No external coverage service for now.
- **Purpose:** feed the CRAP score calculation (see below) and spot untested areas. Targets and any
  gate are decided later, once baseline data exists.

---

## CRAP Metric

**CRAP** (Change Risk Anti-Patterns) combines cyclomatic complexity with branch coverage into a single
risk score per function. It surfaces functions that are both complex *and* poorly tested — the most
likely source of silent defects in AI-generated code.

### Formula

```
CRAP(m) = CC(m)² × (1 − coverage(m)/100)³ + CC(m)
```

| Symbol | Meaning |
|---|---|
| `CC(m)` | Cyclomatic Complexity of function `m` (via `radon`) |
| `coverage(m)` | Branch coverage % of `m` (via `pytest-cov --cov-branch`) |

**Key properties:**
- A simple function (CC = 1) always scores ≤ 2, regardless of coverage.
- A complex function (CC = 10) with zero coverage scores **110** — high risk.
- 100% branch coverage collapses the penalty to zero: `CRAP = CC` (the irreducible floor).

### Risk thresholds

| CRAP score | Risk | Action |
|---|---|---|
| ≤ 30 | LOW | No action required |
| 31–100 | MEDIUM | Flag for review; add tests opportunistically |
| > 100 | HIGH | Requires test coverage before merging further complexity |

### Tooling

Both tools are installed as dev dependencies in every component's `requirements-test.txt`:

```
pytest-cov==5.0.0
radon==6.0.1
```

### Running locally (per backend)

```bash
cd <component>/backend        # or cd <worker-dir>
make setup                    # installs pytest-cov + radon into .venv

# 1. Collect branch coverage
.venv/bin/pytest tests/unit/ \
  --cov=app --cov-branch \
  --cov-report=json:coverage.json \
  --cov-report=term-missing -q

# 2. Collect cyclomatic complexity
.venv/bin/python3 -m radon cc app/ --json > complexity.json

# 3. Compute CRAP scores (flagged functions only, threshold 30)
python3 scripts/crap_score.py \
  --coverage coverage.json \
  --complexity complexity.json

# Optional: exit 1 if any function exceeds 100 (high-risk gate)
python3 scripts/crap_score.py --fail-over 100
```

The script lives at `scripts/crap_score.py` in the repo root.

### CI integration

The **CRAP Report** workflow (`.github/workflows/crap-report.yml`) runs on every PR:

- Runs for all 18 backend components in parallel.
- Collects branch coverage + cyclomatic complexity per component.
- Computes CRAP scores and uploads `crap-report-<component>.txt` as a CI artifact.
- **Does not gate the PR** — report-only mode, mirroring the coverage policy above.

To view a report: open the PR → **Checks** tab → `CRAP Report` run → **Artifacts**.

### Interpretation guide

A high CRAP score on a function means: *if a defect exists in this function, tests are unlikely to
catch it*. That is especially relevant in this codebase because much of the application logic is
AI-generated — complexity combined with low coverage is where silent regressions hide.

Common patterns to watch for:

| Pattern | Typical cause | Fix |
|---|---|---|
| CC ≥ 10, coverage = 0% | LLM-generated router or cascade logic, never unit-tested | Add unit tests covering the branching paths |
| CC ≥ 5, coverage < 30% | Helper function called only through E2E, no unit coverage | Extract and test the logic unit; E2E does not feed CRAP |
| CC = 1, CRAP = 2 | Trivial function, no action | None |

### Scope and limitations

- **Python backends only.** No frontend test infrastructure exists yet; CRAP measurement for
  TypeScript would require adding `vitest` + `@vitest/coverage-v8` (tracked separately).
- **Unit coverage only.** E2E and integration tests run against a live stack over HTTP — they cannot
  be instrumented for per-function branch coverage. The CRAP score is conservative; actual runtime
  coverage may be higher.
- **Branch coverage required.** `--cov-branch` is mandatory. Line coverage alone overstates coverage
  and underestimates CRAP on functions with multiple conditional branches.

