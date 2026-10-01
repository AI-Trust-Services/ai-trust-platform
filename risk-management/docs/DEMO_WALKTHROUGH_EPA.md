# Demo Walkthrough — Employee Performance Analytics

## Step-by-step guide for presenting the Risk Management module to your team

This guide builds a complete risk management cycle live, on **Employee Performance Analytics** — a
HIGH-risk AI system with no prior risk register.

**Important — this is not a numbered wizard.** The assessment opens as a single, continuously
scrollable page with ordered sections (Risk Management Scope → Identified risks → Action plan →
Review → Overall residual risk → Incidents). There is no "Next" button and no step counter — you
simply scroll down and fill in each section. The instructions below are grouped by section, in the
order they appear on the page.

---

## Before you start

1. Open [http://localhost:8080](http://localhost:8080) and log in.
2. Click **Risk Management** in the left sidebar.
3. You land on the **systems list**. Five KPI tiles at the top (Total / High Risk / Action
   Required / In Progress / Completed) are clickable filters. The **Status** column shows a traffic
   light dot per system:
   - Red — high-risk system with no register, an unapproved register, an unacknowledged
     reassessment trigger, an overdue review, or an unacceptable residual risk
   - Orange — register in progress (not yet approved), or approved but risks not yet fully
     confirmed by both required roles
   - Green — approved and every risk fully confirmed (or no risk management needed at all)
4. Click the **Action Required** tile to filter to red systems only.
5. Find **Employee Performance Analytics** — HIGH tier, red dot, **Status** column reads "No risks
   added" or "Not initiated", and the action button reads **Start**.
6. Click **Start**.

**About roles, if you plan to click Confirm live:** confirming a risk's evaluation is gated per
role — only a user holding the **AI Engineer** role can confirm the AI Engineer sign-off, and only
a user holding the **AI Compliance Officer** role can confirm the Compliance Officer sign-off (no
admin override). If you want to demonstrate both confirmations live, make sure two accounts with
those roles already exist (**IAM** in the sidebar → check the users list; if missing, **Add User**
and assign the role). If you'd rather not switch logins mid-demo, build the register as shown below
under your current login (adding/evaluating/mitigating/planning/approving a register itself needs
no special role) and use **Part 2** further down to look at a ready-made example of both
confirmations instead.

---

## Part 1 — Build a cycle on Employee Performance Analytics

### Risk Management Scope

The top card shows a read-only table of whatever registry fields are populated for this system —
typically system name, description, intended purpose, use case, risk tier, and lifecycle stage,
pulled directly from the AI System Registry. Nothing to fill in here.

### Identified risks — empty state

Since this system has no risks yet, you'll see only two buttons: **+ Add Risk** and
**← Back to Overview**. Click **+ Add Risk**.

### Add risk 1 — biased scoring

The form has an **Import from library** button at the top (pre-fills a risk from the shared Risk
Library) — skip it for this one, we're creating from scratch. Fill in (fields marked \* are
required; the form cannot be saved without them):

| Field | Value |
|---|---|
| Short description\* | Biased performance scoring against protected employee groups |
| Description\* | The model may systematically score employees from protected groups (age, gender, ethnicity) lower due to biased training data or proxy variables. |
| Risk owner\* | defaults to your email — leave as is, or set `hr.director@company.com` |
| Impact category\* | Fundamental Rights |
| Severity\* | Significant |
| Likelihood\* | Likely |
| Risk validator\* | click both **AI Engineer** and **Compliance Officer** pills — both must confirm |
| Impact description\* | Employees from protected groups receive unfair performance evaluations, leading to wrongful dismissal or missed promotions. Exposes the company to discrimination liability. |
| Affects vulnerable groups | toggle on → Vulnerable groups\* becomes required: `Elderly, Minorities, People with disabilities` |
| Deadline\* | 30 days from today |

Notice the **risk level badge** next to Severity/Likelihood updates live as you pick values:
Significant × Likely = **Substantial**. (The full matrix is Severe/Significant/Moderate/Minor ×
Very likely/Likely/Possible/Unlikely → Unacceptable/Substantial/Moderate/Acceptable.)

If the platform administrator has the **Risk Library** setting switched on, a second button
appears: **Save & upload to library** (adds this risk to the shared library for reuse on other
systems, in addition to saving it here). If the setting is off, that button is disabled with a
tooltip explaining why. Click plain **Save** for this one.

### Add risk 2 — lack of explainability

Click **+ Add risk** again (now shown next to **+ Add misuse scenario** below the first risk).

| Field | Value |
|---|---|
| Short description\* | Lack of explainability for low performance scores |
| Description\* | Employees and managers cannot understand why a score was assigned, making it impossible to contest unfair evaluations. |
| Risk owner\* | `hr.director@company.com` |
| Impact category\* | Fundamental Rights |
| Severity\* | Moderate |
| Likelihood\* | Likely |
| Risk validator\* | click only **Compliance Officer** — this risk does not require AI Engineer sign-off |
| Impact description\* | Violates GDPR Art. 22 right to explanation for automated decisions. Creates legal exposure in employment disputes. |
| Deadline\* | 45 days from today |

Risk level: Moderate × Likely = **Moderate**.

### Confirming the evaluation

Expand either risk card. Below the summary line you'll see one row per required role:

- Risk 1 requires both roles. If you are **not** AI Engineer or Compliance Officer, both rows show
  as plain read-only text ("AI Engineer: Awaiting confirmation", "Compliance Officer: Awaiting
  confirmation"). If you **are** one of those roles, that role's row becomes a bordered box with
  **Confirm**, **Dismiss**, and **Not my decision** buttons — the *other* role's row always stays
  above yours, as plain info text, so you can never act on their behalf.
- Risk 2 requires only Compliance Officer — if you are AI Engineer, you'll see no actionable row at
  all for this risk, only the read-only Compliance Officer status line.

Editing any evaluation field (severity, likelihood, owner, validator, deadline, etc.) on a risk
resets both confirmations on that risk — this is intentional, so a changed risk is always re-reviewed.

If you are logged in as a user holding the required role, click **✓ Confirm** now on the rows you
can act on. Otherwise, continue building the register and come back to confirmations in Part 2.

### Mitigations (inside each risk card)

Still expanded on risk 1, scroll to **Risk management measures** and add two:

| Hierarchy level | Title | Description |
|---|---|---|
| Eliminate | Remove protected attributes and proxy variables from model inputs | Audit all features used in scoring; remove name, gender, age, ethnicity, postcode, and any variables correlated with protected characteristics. Retrain model after removal. |
| Mitigate | Quarterly third-party bias audit with demographic parity testing | Commission independent bias audit each quarter. Reject and retrain any model version that fails demographic parity at >3% gap threshold. |

On risk 2, add one:

| Hierarchy level | Title | Description |
|---|---|---|
| Mitigate | SHAP-based per-decision explanation report for every score | Generate SHAP feature importance report for every performance score. Make it accessible to the employee and their manager. Retain reports for 3 years for audit purposes. |

The hierarchy (Eliminate → Reduce → Mitigate → Inform) mirrors Art. 9(2)(b)+(c) — eliminating the
risk at the source should always be considered before accepting a residual and merely informing
users about it.

### Residual risk (per risk)

Still inside each risk card, find **Residual risk** and set, for both risk 1 and risk 2:

- Status: **Acceptable**
- Severity: **Minor**
- Likelihood: **Unlikely**

### Action plan — one task per mitigation

Scroll past the risk list to the **Action plan** section. This is the part that is easy to miss:
**approving is blocked** if a risk's residual status is "Acceptable" and any of its mitigations has
no linked follow-up task. Click **+ Add task** and add three tasks (one per mitigation added
above), each with **Linked risk** then **Linked mitigation** selected from the dropdowns that
appear:

| Task title | Linked risk | Linked mitigation | Assigned to | Due date |
|---|---|---|---|---|
| Complete Q3 bias audit | Biased performance scoring… | Quarterly third-party bias audit… | `hr.director@company.com` | 30 days from today |
| Remove proxy variables from scoring model | Biased performance scoring… | Remove protected attributes… | `hr.director@company.com` | 14 days from today |
| Verify SHAP reports are generated for all decisions | Lack of explainability… | SHAP-based per-decision explanation report… | `hr.director@company.com` | 45 days from today |

(A task with no mitigation selected just links to the risk itself — useful for general follow-up
work that doesn't correspond to a specific mitigation measure, but doesn't satisfy the gate above.
Tip: you can also add a task from inside a risk's own card, under its **Tasks** subsection — there
it's already scoped to that risk, so you only pick the mitigation, not the risk.)

By default this section only lists tasks that aren't linked to a risk in this register — toggle
**Show all tasks** to see the three you just added.

### Review

Scroll to the **Review** section, which has two cards:

- **Reviewer** — defaults to your own email address. Leave it as is, or set it to whoever will
  review this cycle.
- **Scheduled review date** — set a date **3 months from today**. The field refuses dates more than
  6 months out — this enforces Art. 9(1)'s iterative-monitoring requirement.

### Overall residual risk

Scroll to **Overall residual risk**:

| Field | Value |
|---|---|
| Residual risk acceptable | Yes |
| Argument | Residual risk is acceptable following implementation of bias elimination controls and mandatory explainability reporting. Quarterly independent audits ensure ongoing compliance. The system must not be deployed until the bias audit and SHAP reporting are implemented and verified. |

### Incidents (optional)

Scroll to the **Incidents** section and click **Report incident**:

| Field | Value |
|---|---|
| Incident title | Performance scores flagged as potentially biased for part-time employees |
| Description | Three managers independently reported that part-time employees scored significantly lower than full-time peers with equivalent output metrics. Suspected training data imbalance. |
| Linked risk | Biased performance scoring against protected employee groups |
| Reported by | `hr.director@company.com` |

Incidents remain visible and editable even after the register is approved — this is where you log
and track situations where a risk actually materialized. Like Action plan, this section shows
"Other incidents" by default — toggle **Show all incidents** to see ones linked to a risk.

### Approve

Scroll to the bottom and click **Approve**. If anything required is still missing (no mitigation on
a HIGH-tier risk, a mitigation without a linked task, no review date, or a review date past 6
months), a clear error message lists exactly what's missing — fix it and try again.

**Expect the traffic light to stay orange after approving**, unless you already confirmed both
roles on both risks earlier. Approving the register and fully confirming every risk are two
independent gates — the light only turns green once both are satisfied. This is intentional: an
approved-but-unconfirmed register is still "in progress" from a governance point of view.

### After approval

- The register locks to read-only; a green **Approved** banner appears.
- **Export report** generates a printable HTML summary.
- Return to the systems list — Employee Performance Analytics should now show a non-red dot
  (orange, until every risk is fully confirmed; green once it is).

---

## Part 2 — The asymmetric per-role confirmation UI

Building confirmations into Part 1 requires switching logins. To see every confirmation state at
once, without any setup, open the **Medical Image Diagnosis Assistant** system instead — its
in-progress register was seeded specifically to demonstrate this:

- One risk with both roles still pending
- One risk with AI Engineer confirmed, Compliance Officer still pending
- One risk with AI Engineer confirmed, Compliance Officer chose **Not my decision**
- One risk requiring only the Compliance Officer
- One risk requiring only the AI Engineer

Open it and expand a few risks. Notice:

- The role you are **not** allowed to act on always renders as a plain text line, above, with a dot
  bullet and no border — pure information, not an action panel.
- The role you **are** allowed to act on renders as a bordered box below it, with the actual
  **✓ Confirm** / **Dismiss** / **Not my decision** buttons (or **Undo**, if already confirmed or
  abstained).
- There is **no general "confirm" button** anywhere — confirmation is always scoped to the logged-in
  user's own role.

If you want to click through the actions live, log in as the `ai_engineer`-role account and then
the `ai_compliance_officer`-role account (see "Before you start" above) and repeat on the same
risk — you'll see your own panel move from pending → confirmed, while the other role's info line
updates independently above it.

---

## What this demonstrates

| Section | EU AI Act obligation |
|---|---|
| Identified risks | Art. 9(2)(a) — known and foreseeable risks; Art. 9(9) — vulnerable groups; risk validator + deadline per risk |
| Confirmation (AI Engineer / Compliance Officer) | Art. 9(2)(a) — independent human review; any edit resets both confirmations |
| Risk management measures | Art. 9(2)(b)+(c) — mitigation hierarchy (Eliminate → Reduce → Mitigate → Inform) |
| Residual risk (per risk and overall) | Art. 9(2)(d) — residual risk after mitigation |
| Action plan | Closes the loop: every mitigation backing an "acceptable" residual claim needs a concrete, owned, dated action |
| Review (reviewer + scheduled review date) | Art. 9(1) — iterative monitoring, ≤6 months |
| Overall residual risk + Approve | Art. 9(5) — expert sign-off |
| Incidents | Art. 9(2)(c) — post-market signal capture (manual logging; no automated ingestion yet) |

## Traffic light states visible in the demo seed

| System | Tier | State | Reason |
|---|---|---|---|
| HR Candidate Screening AI | High | Green | Approved, all risks fully confirmed |
| Meeting Transcription Tool | Minimal | Green | Voluntary register, approved and confirmed |
| Internal Knowledge Base Search | Minimal | Green | No register needed |
| Credit Risk Assessment Model | High | Red | Unacknowledged reassessment trigger |
| Loan Approval Automation | High | Red | Approved register overdue (>6 months) |
| Medical Image Diagnosis Assistant | High | Orange | In-progress (draft) register — see Part 2 above |
| Customer Support Chatbot | Limited | Orange | Register stale (>6 months, voluntary) |
| Social Scoring Pilot | Prohibited | Red | No mitigation path exists for a prohibited system |
| Employee Performance Analytics | High | Red (until you build a cycle) | No register — this is the walkthrough's starting point |
| Internal Analytics Dashboard | Pending | Orange | Tier not yet classified by the registry |
| Supplier Due Diligence Tool | Minimal | Green | No register needed; `org_role` forced to NULL — edge case for incomplete registry data (does not affect the traffic light) |

Exact states can shift as the seed script evolves — use the systems list's own KPI tiles and Status
column as the source of truth; this table is a guide to what to look for.
