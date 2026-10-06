# Test strategy — visualization candidates (TEMPORARY)

> Pick one option for [tests.md](tests.md). The chosen diagram(s) move into `tests.md` and this
> file is deleted before merge.
>
> Line styles in all flow diagrams: **thick `==>`** = blocks / is a gate · **solid `-->`** =
> runs, informational · **dashed `-.->`** = planned (label says so).

---

## Option A — Pyramid + CI flow (two diagrams)

**A1 — What each level tests (scope grows upwards)**

```mermaid
flowchart BT
    L["<b>Lint · Format · Typecheck</b><br/>ruff · tsc — no execution"]
    U["<b>Unit</b><br/>pure logic · no I/O"]
    E["<b>E2E (per service)</b><br/>one service in-process · real Postgres / ClickHouse<br/>MinIO + OpenFGA mocked"]
    D["<b>Deployment test</b><br/>build → OCM → Flux · pods ready"]
    I["<b>Integration</b><br/>live namespace · real HTTP across services · stub LLM"]
    AI["<b>AI output evaluation</b><br/>RCE accuracy vs. labelled dataset<br/><i>planned</i>"]

    L --> U --> E --> D --> I
    I -.-> AI

    classDef done fill:#d1fae5,stroke:#059669,color:#064e3b
    classDef partial fill:#fef3c7,stroke:#d97706,color:#78350f
    classDef planned fill:#f3f4f6,stroke:#9ca3af,color:#374151,stroke-dasharray:4 3
    class L,U,D,I done
    class E partial
    class AI planned
```

**A2 — When each level runs**

```mermaid
flowchart LR
    PR([Pull request])
    LINT[Lint · Typecheck · Title]
    UNIT[Unit tests]
    E2E[E2E per service]
    MERGE{{Merge to main}}
    DEPT[Deployment test<br/>ai-trust-test / PR namespace]
    DEPM[Deployment<br/>ai-trust-main / ai-trust]
    INT[Integration tests]

    PR ==> LINT ==> MERGE
    PR ==> UNIT ==> MERGE
    PR -. "planned" .-> E2E -.-> MERGE
    PR -- "label garden-deploy" --> DEPT --> INT
    MERGE --> DEPM --> INT
```

*Pros:* answers "what" and "when" separately, both stay readable. *Cons:* two diagrams to maintain.

---

## Option B — CI flow + levels table

```mermaid
flowchart LR
    subgraph PRG["Pull request"]
        direction TB
        LINT[Lint · Typecheck]
        UNIT[Unit]
        E2E["E2E<br/><i>planned</i>"]
        DEPT["Deployment test<br/><i>opt-in: garden-deploy</i>"]
    end
    subgraph MAIN["main"]
        direction TB
        DEPM[Deployment]
    end
    subgraph LIVE["Live namespace"]
        direction TB
        INT[Integration]
        AI["AI output evaluation<br/><i>planned</i>"]
    end

    LINT ==> DEPM
    UNIT ==> DEPM
    E2E -.-> DEPM
    DEPT --> INT
    DEPM --> INT
    INT -.-> AI
```

| Level | Boundary | Blocks merge |
|---|---|---|
| Lint / typecheck | no execution | reported (required: proposed) |
| Unit | pure logic | reported (required: proposed) |
| E2E | 1 service + DB | planned |
| Deployment test | rollout healthy | PR check (opt-in) |
| Integration | live, cross-service | no |
| AI output evaluation | AI accuracy | 🔶 TBD |

*Pros:* one diagram; detail lives in a table that's easy to edit. *Cons:* the levels' scope isn't visual.

---

## Option C — Swimlane by stage

```mermaid
flowchart LR
    subgraph S1["① Local (developer)"]
        direction TB
        a1[Lint · Typecheck]
        a2[Unit]
        a3["E2E<br/>docker compose postgres"]
        a4["Integration<br/>kind: make test-int"]
    end
    subgraph S2["② Pull request (GitHub runner)"]
        direction TB
        b1[Lint · Typecheck · Title]
        b2[Unit]
        b3["E2E — planned"]
    end
    subgraph S3["③ PR namespace (ai-trust-test)"]
        direction TB
        c1[Deployment test]
        c2[Integration]
    end
    subgraph S4["④ main (ai-trust-main)"]
        direction TB
        d1[Deployment]
        d2[Integration]
        d3["AI output evaluation — planned"]
    end

    S1 --> S2 --> S3 --> S4
    c1 --> c2
    d1 --> d2
    d2 -.-> d3

    classDef planned fill:#f3f4f6,stroke:#9ca3af,color:#374151,stroke-dasharray:4 3
    class b3,d3 planned
```

*Pros:* shows where a developer can reproduce each level locally. *Cons:* blocking vs. informational is less visible.

---

## Option D — MVP flow × test levels matrix

Coverage of the four MVP steps per level (✅ exists · ⬜ missing · ⚠️ partial · — not applicable).

| MVP step | Unit | E2E | Integration | AI output evaluation |
|---|---|---|---|---|
| 1. Registration | ✅ | ✅ | ⚠️ register + RBAC only | — |
| 2. Self-assessment | ✅ | ✅ | ⬜ | ⬜ (AI pre-fill) |
| 3. Risk classification | ✅ classifier waterfall | ✅ | ⚠️ obligation set only | ⬜ |
| 4. Classification confirmation | ✅ | ✅ | ⬜ (audit gap) | — |

*Pros:* ties test levels directly to the business flow, which is the PM's view. *Cons:* the unit/E2E
cells need verifying per scenario and go stale quickly; best combined with A2 or B.

---

## Option E — Development loop

One change goes round the loop: develop → PR checks → deploy to `ai-trust-test` → live tests →
merge → deploy to `ai-trust-main` → live tests → next change. A red step sends the change back to
**Develop**.

**E1 — Loop as a flowchart**

```mermaid
flowchart LR
    DEV(["① Develop<br/>local: lint · unit · E2E"])
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

**E2 — Loop as a cycle**

```mermaid
stateDiagram-v2
    direction LR
    state "① Develop (local: lint · unit · E2E)" as Develop
    state "② PR checks (lint · typecheck · unit)" as PRChecks
    state "③ Deploy to ai-trust-test (PR namespace)" as DeployTest
    state "④ Live E2E + integration on ai-trust-test" as LiveTest
    state "⑤ Merge to main" as Merge
    state "⑥ Deploy to ai-trust-main (ai-trust)" as DeployMain
    state "⑦ Live E2E + integration on ai-trust-main" as LiveMain

    [*] --> Develop
    Develop --> PRChecks
    PRChecks --> DeployTest : green
    PRChecks --> Develop : red
    DeployTest --> LiveTest
    LiveTest --> Merge : green
    LiveTest --> Develop : red
    Merge --> DeployMain
    DeployMain --> LiveMain
    LiveMain --> Develop : next change
```

*Pros:* shows testing as a continuous development cycle, and makes the two environments (PR test
cluster vs. central system) visible. *Cons:* Mermaid has no true circular layout; the loop is shown
by the return edge, not by a drawn circle.
