# Test Strategy — AI Trust Platform MVP

> **Status: DRAFT — for review with PM and engineering lead**.
> Sections marked **🔶 Open** need a decision before this document is approved.

## Executive summary

- **Test levels:** lint/typecheck, unit, deployment test, E2E (per service), integration and E2E system
  (see [Test levels](#test-levels)). AI output evaluation is planned on top (see [AI output evaluation](#ai-output-evaluation))
- **Two live-platform levels, two perspectives**:
  - **Integration** is the technical perspective: cross-service integration (contracts, shared data,
    cascades, internal calls), see
    [MVP integration scenarios](#mvp-integration-scenarios).
  - **E2E system** is the domain perspective: MVP business requirements driven through persona flows,
    see [MVP E2E system scenarios](#mvp-e2e-system-scenarios).
- **MVP acceptance is defined by business flow, not code coverage.** Every MVP step
  (Registration → Self-assessment → Risk classification → Classification confirmation) has a set of
  mandatory **E2E system** scenarios. **Integration** scenarios back them with technical proof.
- **Coverage targets:** 🔶 TBD. No coverage targets for now.

## Test levels

| Repo term | Industry term | Boundary |
|---|---|---|
| Lint / typecheck | Static analysis | Code validation |
| Unit | Unit | Pure logic, no I/O |
| Deployment test | Smoke / deployment verification | Helm/OCM rollout healthy, K8s (liveness & readiness probes) |
| E2E per service | End to end micro service | One service in-process + real DB, other services mocked |
| Integration | Cross-service technical integration | Technical contracts between deployed services over real HTTP: shared data, cascades, internal calls. See [integration scenarios](#mvp-integration-scenarios) |
| E2E System | System / end-to-end (API level), domain | MVP business requirements: persona flows driven black-box through the whole deployed platform; no browser or login. See [E2E system scenarios](#mvp-e2e-system-scenarios) |

Rule of thumb: a scenario that exists because of a **technical contract between services** is
Integration; one that exists because of a **business requirement or persona flow** is E2E system.

---

## Development loop

One change goes round the loop: develop → PR checks → deploy to `ai-trust-test` → live tests →
merge → deploy to `ai-trust-main` → live tests → next change. A red step sends the change back to
**Develop**.

```mermaid
flowchart LR
    DEV(["① Local<br/>development: lint · typecheck · unit · E2E · integration"])
    PR["② PR checks<br/>lint · typecheck · unit"]
    DT["③ Deploy PR<br/><b>ai-trust-test</b><br/>PR namespace"]
    LT["④ Live tests on ai-trust-test<br/>E2E · integration"]
    MG{{"⑤ Merge to main"}}
    DM["⑥ Deploy main<br/><b>ai-trust-main</b><br/>namespace ai-trust"]
    LM["⑦ Live tests on ai-trust-main<br/>E2E · integration"]

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

### Quality gates

| Gate | Criteria |
|---|---|
| **PR mergeable** | Lint, format, typecheck, unit, E2E, integration green checks |
| **`main` deployment** | Deployment workflow green · E2E & integration green otherwise investigate any red `e2e-tests`/ `integration-tests` status before the next merge |

---

## MVP integration scenarios

**Cross-service technical integration**: proof that services work together: contracts, shared data,
internal calls and platform wiring. A failure points to a broken technical seam. MVP business
requirements and the 1–7 lifecycle structure are covered in
[MVP E2E system scenarios](#mvp-e2e-system-scenarios).

Organised by technical seam, not by MVP step. Legend: ✅ test covered · ⬜ test missing, functionality
exists · 🔶 proposed, expected behaviour to be confirmed with the owning team

### A. Platform wiring and reachability

Basic for MVP: plain HTTP requests, with no browser and no login. They catch a missing bundle, a broken
nginx route or an unhealthy backend.

| Scenario | State |
|---|---|
| Health of all 7 backends (each `/health` also checks its DB connection) | ✅ `test_01_health.py` |
| Shell entry page is served (HTTP 200, HTML) | ⬜ |
| MVP frontends (Registry, Compliance) are served through the shell proxy (HTTP 200, HTML) | ⬜ |
| MVP backend APIs (Registry, Compliance) are reachable through the shell proxy | ⬜ |
| `/api/*/health` of every backend answers through the shell proxy (route per backend) | 🔶 |

### B. Shared data: registry ↔ compliance (`ai_systems`)

| Scenario | State |
|---|---|
| System registered in the registry is visible in compliance | ✅ `test_02_registry_compliance.py` |
| Reclassification in the registry (tier change) is visible in compliance | 🔶 |
| System deleted in the registry is no longer visible in compliance | 🔶 |

### C. Service-to-service HTTP

| Scenario | State |
|---|---|
| Admin stats call the users backend | ✅ `test_03_rbac.py` |

### D. Authorization: backends ↔ OpenFGA via the IAM API

Role changes are made through the users/IAM API and must take effect in other backends. This checks the
technical wiring (tuples written by one service, read by another), not which persona may do what (that
is E2E system).

| Scenario | State |
|---|---|
| Role assigned via IAM API grants access on registry / compliance; reassigning replaces the previous role (single-role invariant) | 🔶 |
| Custom role created via IAM API grants its permissions on another backend; deleting it revokes them | 🔶 |
| User without any role is denied on every protected backend (fails closed) | 🔶 |
| Identity header fallback: `X-Forwarded-User` (OIDC `sub`) is accepted when the username header is absent | 🔶 |

### E. Platform dependencies used by one service

| Scenario | State |
|---|---|
| Registry ↔ LLM provider: an AI-assist call with the deterministic stub provider returns a well-formed response | 🔶 |
| Compliance ↔ MinIO: an uploaded evidence file can be retrieved through its presigned URL | 🔶 |

Out of scope for now (async timing or extra infrastructure): audit trail flush
(Postgres buffer → ClickHouse), alert rule firing, OTel pipeline (RabbitMQ → ClickHouse).

---

## MVP E2E system scenarios

**Domain MVP business requirements**: proof that the MVP flow behaves as the business requires for
each persona. These scenarios are the MVP acceptance criteria. A failure points to an unmet
requirement. Technical contract checks live in
[MVP integration scenarios](#mvp-integration-scenarios).

Legend: ✅ test covered · ⬜ test missing, functionality exists

Structure follows the lifecycle steps 1–7. Personas: Application Owner, AI Engineer, Compliance Officer.

### 1. Registration

| Scenario | State |
|---|---|
| AI Engineer can register a system | ⬜ |
| Role without write permission (e.g. Auditor) cannot register (403) | ✅ `test_03_rbac.py` |
| AI-assisted registration: conversational intake and an uploaded document pre-fill the registration fields (the document is parsed, not stored) | ⬜ |

### 2. Self-assessment

| Scenario | State |
|---|---|
| Self-assessment started for a registered system → assessment `questionnaire_pending` (compliance); section assignees, Compliance Officer and intended purpose recorded on the system (registry) | ⬜ |
| Application Owner submits the business section → AI Engineer submits the technical section → system `pending_review` | ⬜ |
| EU AI Act role (provider / deployer / both) set for the system: entered at registration, inferred by the AI at classification | ⬜ |
| Single question delegated to a contributor and answered | ⬜ |

### 3. Risk classification

| Scenario | State |
|---|---|
| Obligation set generated for a system classified before the assessment starts | ✅ `test_02_registry_compliance.py` |
| AI mode (default): free-text technical answers → AI-inferred flags, tier, EU AI Act role and per-criterion rationale with confidence stored | ⬜ |
| Classification completed → obligations and requirements generated for the classified tier and role; assessment `pending_review` | ⬜ |
| Platform administrator cannot read assessments (403) | ✅ `test_03_rbac.py` |
| Changed flags + reclassify update the tier | ⬜ |

### 4. Classification confirmation

| Scenario | State |
|---|---|
| Assigned Compliance Officer reviews the AI rationale per criterion and the obligation set; other users don't see the rationale | ⬜ |
| Compliance Officer approves → system `approved` (registry) and assessment `approved` (compliance); risk flags locked (422) | ⬜ |
| Compliance Officer corrects tier and/or EU AI Act role on approval → corrected values stored (a tier correction is noted in the basis) | ⬜ |
| Reject → system back to the chosen section and assessment reopened (`questionnaire_pending`); request-info → only the reopened section editable | ⬜ |
| Only the assigned Compliance Officer can confirm: AI Engineer and Application Owner get 403; unanswered required questions get 422 | ⬜ |

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
| AI Engineer cannot approve evidence (403) | ✅ `test_03_rbac.py` |

Monitoring follows Approval in the lifecycle and is outside MVP scope; no E2E system scenarios.


---

## AI output evaluation

> Metrics and thresholds are not decided. Will be covered with AI Assisted functionality implementation.

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

## Coverage targets

🔶 **TBD.** No coverage tooling (`pytest-cov`) is configured. Targets will be defined once baseline
data exists. Until then, MVP acceptance is measured by the business scenarios above.

---

## Open questions

🔶 To decide in the review with PM and engineering lead:

| # | Question | Affects |
|---|---|---|
| 1 | Is frontend tests part of MVP ? |
| 2 | Is test coverage part of MVP ? |

---

## Next steps

| # | Action | State |
|---|---|---|
| 1 | Review and approve this document with PM and engineering lead, including the open questions | 🔶 open |
| 2 | After approval: create follow-up issues | 🔶 open  |

### Proposed follow-up issues (create after approval)

1. **Integration tests:** implement every ⬜ scenario and, once confirmed, the 🔶 proposals in
   [MVP integration scenarios](#mvp-integration-scenarios) in `tests/integration/` Milestone: DevOps.
2. **E2E system tests for the MVP flow:** implement every ⬜ scenario in
   [MVP E2E system scenarios](#mvp-e2e-system-scenarios). 🔶 Location and CI status name to decide
   (new suite vs. a marker in `tests/integration/`). Milestone: DevOps.
