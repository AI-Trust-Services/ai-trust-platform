# Test Strategy — AI Trust Platform MVP

> **Status: DRAFT — for review with PM and engineering lead**.
> Sections marked **🔶 Open** need a decision before this document is approved.

## Executive summary

- **Five test levels:** lint/typecheck, unit, deployment test, E2E (per service) and integration
  (see [Test levels](#test-levels)). AI output evaluation is planned on top (**🔶 open, review with
  AI Lead**).
- **MVP acceptance is defined by business flow, not code coverage.** Every MVP step
  (Registration → Self-assessment → Risk classification → Classification confirmation) has a set of
  mandatory **integration** scenarios (see [MVP integration scenarios](#mvp-integration-scenarios)).
  They run in AI-assisted mode with the stub LLM and check registry and compliance together, because
  the Compliance UI drives each step across both services.
- **Most of the functionality exists; most of the tests do not.** Functional gaps are marked ⚠️ / ❌;
  decisions needed in the review are listed under [Open questions](#open-questions).
- **Coverage targets:** 🔶 TBD. No coverage targets for now.

## Test levels

| Repo term | Industry term | Boundary |
|---|---|---|
| Lint / typecheck | Static analysis | No execution |
| Unit | Unit | Pure logic, no I/O |
| Deployment test | Smoke / deployment verification | Helm/OCM rollout healthy |
| E2E | Service / component integration | One service in-process + real DB, other services mocked |
| Integration | System / cross-service E2E | Live namespace, real HTTP between services |

---

## Development loop

One change goes round the loop: develop → PR checks → deploy to `ai-trust-test` → live tests →
merge → deploy to `ai-trust-main` → live tests → next change. A red step sends the change back to
**Develop**.

```mermaid
flowchart LR
    DEV(["① Develop<br/>local: lint · unit · E2E"])
    PR["② PR checks<br/>lint · typecheck · unit · E2E (planned)"]
    DT["③ Deploy PR<br/><b>ai-trust-test</b><br/>PR namespace"]
    LT["④ Live tests on ai-trust-test<br/>integration (system E2E)"]
    MG{{"⑤ Merge to main"}}
    DM["⑥ Deploy main<br/><b>ai-trust-main</b><br/>namespace ai-trust"]
    LM["⑦ Live tests on ai-trust-main<br/>integration (system E2E)"]

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

---

## MVP integration scenarios

Legend: ✅ test exists · ⬜ test missing, functionality exists · ⚠️ functionality partly missing ·
❌ functionality missing · 🔶 open decision

Personas: Application Owner (`business_owner`), AI Engineer (`ai_engineer`), Compliance Officer
(`ai_compliance_officer`). AI-mode scenarios assume the deterministic stub LLM provider on the target
namespace (🔶 verify for `ai-trust-main`).

### 0. Health checks

Frontend checks are kept basic for MVP: plain HTTP requests in the same integration suite, with no
browser and no login. They catch a missing bundle or a broken nginx route. UI behaviour is checked
in PM walkthroughs.

| Scenario | State |
|---|---|
| Health of all 7 backends | ✅ `test_01_health.py` |
| Admin stats call the users backend | ✅ `test_03_rbac.py` |
| Shell entry page is served (HTTP 200, HTML) | ⬜ |
| MVP frontends (Registry, Compliance) are served through the shell proxy (HTTP 200, HTML) | ⬜ |
| MVP backend APIs (Registry, Compliance) are reachable through the shell proxy | ⬜ |

### 1. Registration

| Scenario | State |
|---|---|
| Application Owner registers a system → visible in registry and compliance | ✅ `test_02_registry_compliance.py` |
| AI Engineer can register a system | ⬜ |
| Role without write permission (e.g. Auditor) cannot register (403) | ✅ `test_03_rbac.py` |
| AI-assisted registration: conversational intake and an uploaded document pre-fill the registration fields (the document is parsed, not stored) | ⬜ |
| Full manual registration: supporting document stored with the system | ⚠️ document storage exists, but no path registers a system in full manual mode · 🔶 |
| Model card linked to the system | ⬜ · 🔶 in MVP scope? |

### 2. Self-assessment

| Scenario | State |
|---|---|
| Self-assessment started for a registered system → assessment `questionnaire_pending` (compliance); section assignees, Compliance Officer and intended purpose recorded on the system (registry) | ⬜ |
| Application Owner submits the business section → AI Engineer submits the technical section → system `pending_review` | ⬜ |
| EU AI Act role (provider / deployer / both) set for the system: entered at registration, inferred by the AI at classification | ⬜ |
| Single question delegated to a contributor and answered | ⬜ |
| Self-assessment cannot reach confirmation without an assigned Compliance Officer | ⚠️ required in the UI, not enforced by the API |

### 3. Risk classification

| Scenario | State |
|---|---|
| AI mode (default): free-text technical answers → AI-inferred flags, tier, EU AI Act role and per-criterion rationale with confidence stored | ⬜ |
| Classification completed → obligations and requirements generated for the classified tier and role; assessment `pending_review` | ⬜ |
| Obligation set generated for a system classified before the assessment starts | ✅ `test_02_registry_compliance.py` |
| Changed flags + reclassify update the tier | ⬜ |
| Platform administrator cannot read assessments (403) | ✅ `test_03_rbac.py` |
| Manual questionnaire mode: tier and basis match the deterministic classifier for the answered flags | ⚠️ offered in the UI, but every system is registered in AI mode and the mode can't be changed, so the answered flags are not used · 🔶 |
| External tier: tier entered directly → obligation set generated for that tier | ⚠️ offered in the UI, but the entered tier is ignored and the classification stays pending · 🔶 |
| Confidence threshold routes the classification: fast track at or above, per-criterion review below | ❌ · 🔶 classification approach not confirmed |
| AI analysis of linked source code and documentation | ❌ · 🔶 classification approach not confirmed |

### 4. Classification confirmation

| Scenario | State |
|---|---|
| Assigned Compliance Officer reviews the AI rationale per criterion and the obligation set; other users don't see the rationale | ⬜ |
| Compliance Officer approves → system `approved` (registry) and assessment `approved` (compliance); risk flags locked (422) | ⬜ |
| Compliance Officer corrects tier and/or EU AI Act role on approval → corrected values stored (a tier correction is noted in the basis) | ⬜ |
| Obligation set matches the confirmed classification after a correction or a send-back that changes the tier | ⚠️ obligations are generated once and not regenerated · 🔶 |
| Reject → system back to the chosen section and assessment reopened (`questionnaire_pending`); request-info → only the reopened section editable | ⬜ |
| Confirming in the Registry UI keeps the compliance assessment in step | ⚠️ the Registry UI approves or rejects the system only; the assessment stays `pending_review` |
| Only the assigned Compliance Officer can confirm: AI Engineer and Application Owner get 403; unanswered required questions get 422 | ⬜ |
| Confirmation recorded in the audit trail, including tier and role | ⚠️ the assessment approval is audited; classification transitions, tier/role corrections and reject/reopen are not |
| Classification history kept: earlier tier, rationale and approval retrievable | ❌ tier and basis are overwritten · 🔶 |

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

Monitoring follows Approval in the lifecycle and is outside MVP scope; no integration scenarios.

---

## AI output evaluation

> **🔶 Open — to review with AI Lead.** Metrics and thresholds are not decided.

Placeholder scope, to be confirmed:
- **What:** accuracy of the AI-assisted RCE: flags extracted from questionnaire answers and uploaded
  documents, and the resulting tier and EU AI Act role, against a labelled dataset covering all tiers.
- **Inputs:** labelled dataset, evaluation pipeline and test bed (planned).
- **Relation to functional tests:** integration tests prove the workflow works with a deterministic
  stub. Evaluation proves the AI output is good enough. A release needs both.
- **To decide:**
  - metrics (per-tier precision/recall?) and MVP thresholds
  - confidence calibration, needed if a confidence threshold routes classifications
  - label mapping: the MVP scope uses combined classes (e.g. high risk + transparency), while the
    classifier returns a single tier and also has GPAI tiers
  - which LLM provider and model is evaluated, and whether evaluation runs in CI or on demand

---

## Quality gates (proposed)

| Gate | Criteria |
|---|---|
| **PR mergeable** | Lint, format, typecheck, unit green · E2E green once it runs in CI · these configured as required checks on `main` |
| **Deployed to `main`** | Deployment workflow green · integration suite green (investigate any red `integration-tests` status before the next merge) |
| **MVP testable** | All four MVP steps deployed on `ai-trust-main` · every in-scope scenario in [MVP integration scenarios](#mvp-integration-scenarios) implemented and green there (🔶 scenarios once decided) |

The MVP milestone also requires testing from the user (PM) perspective. That is done in PM
walkthroughs, outside this document.

## Coverage targets

🔶 **TBD.** No coverage tooling (`pytest-cov`) is configured. Targets will be defined once baseline
data exists. Until then, MVP acceptance is measured by the business scenarios above.

---

## Open questions

🔶 To decide in the review with PM and engineering lead:

| # | Question | Affects |
|---|---|---|
| 1 | Which classification modes are part of the MVP: AI-assisted (default), manual questionnaire, external tier, full manual? Today only AI mode takes effect in the backend. | Registration, Risk classification |
| 2 | Is linking model cards to systems in MVP scope? The MVP scope excludes LLM card linking. | Registration |
| 3 | Should the obligation set be regenerated when the confirmed classification differs from the first one (Compliance Officer correction, send-back)? | Classification confirmation |
| 4 | Is classification versioning (history of tier, rationale and approval) required for the MVP? | Classification confirmation |
| 5 | Are a confidence threshold with fast track and AI analysis of source code part of the MVP classification approach? | Risk classification, AI output evaluation |
| 6 | Which LLM provider runs on `ai-trust-main`? AI-mode scenarios are deterministic only with the stub provider. | Steps 1–4 |

---

## Next steps

| # | Action | State |
|---|---|---|
| 1 | Review and approve this document with PM and engineering lead, including the open questions | 🔶 pending |
| 2 | Decide AI output evaluation metrics and thresholds with AI Lead | 🔶 pending |
| 3 | After approval: create follow-up issues (below) | not started |
| 4 | Configure required status checks on `main` (lint, typecheck, unit; E2E once it runs in CI) | not started |
| 5 | Define coverage targets once tooling and baseline exist | not started |

### Proposed follow-up issues (create after approval)

1. **Integration tests for the MVP flow:** implement every ⬜/⚠️ scenario in
   [MVP integration scenarios](#mvp-integration-scenarios) in `tests/integration/`, in AI mode with
   the stub LLM, checking registry and compliance state together for steps 2–4, including the basic
   frontend availability checks (0. Health checks). Milestone: DevOps.
2. **Record classification decisions in the audit trail:** `ai-system-registry`
   `routers/workflow.py` (submit-technical, approve incl. tier/`org_role` correction old → new,
   reject, request-info, submit-info) writes `system_workflow_steps` and logs, but no
   `log_audit_event`. Compliance audits the assessment approval, but not the reopen. This blocks the
   audit assertion in step 4 (Classification confirmation). Milestone: Core.
3. **Required status checks on `main`:** make the existing PR checks blocking.
4. **Keep registry and compliance consistent on confirmation:** confirming in the Registry UI
   approves or rejects the system only; the compliance assessment stays `pending_review`.
   Milestone: Core.
5. **Classification modes (depends on open question 1):** make the selected mode take effect in the
   backend, or remove it from the UI. Intake fixes every system to AI mode and the mode can't be
   updated; the registry E2E workflow tests that assume manual questionnaire mode actually run in AI
   mode with the stub. Milestone: RCE.
6. **Depending on open questions 3 and 4:** regenerate the obligation set after a changed
   classification; classification versioning. Milestone: RCE.

---

## Maintaining this document

Update `docs/tests.md` in the same PR whenever you add or change a test level, a CI test workflow,
a quality gate, or an MVP integration scenario (flip ⬜ → ✅).
