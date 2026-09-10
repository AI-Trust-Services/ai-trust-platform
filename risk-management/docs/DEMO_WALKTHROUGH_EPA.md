# Demo Walkthrough — Employee Performance Analytics
## Step-by-step guide for presenting the Risk Management module to your team

This guide walks you through a complete risk management cycle for the **Employee Performance Analytics** system — a HIGH-risk AI system with no prior risk management record. Use it to demonstrate all five wizard steps live.

---

## Before you start

1. Open [http://localhost:8080](http://localhost:8080) and log in.
2. Click **Risk Management** in the left sidebar (shield icon).
3. Find **Employee Performance Analytics** in the list — it shows a red status dot, badge **"No risk management"**, and a green **Start** button.
4. Click **Start**.

---

## Step 1 — Scope

**What to say:** *"Every risk management cycle begins by defining what exactly we're assessing. This fulfils Art. 9(2)(a) of the EU AI Act — you must know the boundaries of what you're evaluating."*

Paste into the **Assessment scope** field:

> This assessment covers the Employee Performance Analytics system used by the HR department to evaluate employee productivity and flag underperformers for managerial review. Scope includes: automated scoring of individual employees, potential bias against protected groups (age, gender, ethnicity, disability), transparency and explainability of scores, data privacy under GDPR, human oversight requirements, and compliance with EU AI Act Art. 9 obligations for HIGH-risk employment-related AI systems.

Leave **Notes** empty. Click **Next**.

---

## Step 2 — Identify risks

**What to say:** *"We now identify every foreseeable risk. The form captures the risk type (known vs foreseeable — an Art. 9(2)(a) distinction), severity and likelihood, and whether vulnerable groups are affected (Art. 9(9))."*

### Risk 1

| Field | Value |
|---|---|
| Title | Biased performance scoring against protected employee groups |
| Description | The model may systematically score employees from protected groups (age, gender, ethnicity) lower due to biased training data or proxy variables. |
| Category | Bias |
| Risk type | Foreseeable |
| Likelihood | Likely |
| Severity | High |
| Risk owner | hr.director@company.com |
| Impact | Employees from protected groups receive unfair performance evaluations, leading to wrongful dismissal or missed promotions. Exposes the company to discrimination liability. |
| Affects vulnerable groups | ✓ Check |
| Vulnerable groups | Elderly, Minorities, People with disabilities |

Click **Add risk**.

### Risk 2

| Field | Value |
|---|---|
| Title | Lack of explainability for low performance scores |
| Description | Employees and managers cannot understand why a score was assigned, making it impossible to contest unfair evaluations. |
| Category | Legal |
| Risk type | Known |
| Likelihood | Likely |
| Severity | Medium |
| Risk owner | hr.director@company.com |
| Impact | Violates GDPR Art. 22 right to explanation for automated decisions. Creates legal exposure in employment disputes. |

Click **Add risk**. Then click **Next**.

---

## Step 3 — Evaluate

**What to say:** *"We now confirm or dismiss each identified risk. Confirmed risks proceed to mitigation. A dismissed risk requires a justification — you cannot simply ignore a risk without documenting why."*

For both risks:
- Click **Confirm** (do not dismiss either — both are real risks for this system).

Click **Next**.

---

## Step 4 — Mitigate

**What to say:** *"The mitigation step enforces the EU AI Act Art. 9(2)(b)+(c) hierarchy: first try to eliminate the risk at source, then reduce it, then mitigate residual effects, and only if nothing else works — inform users. The tool enforces this order."*

### Mitigation for Risk 1 — Biased scoring

| Field | Value |
|---|---|
| Hierarchy level | Eliminate |
| Title | Remove protected attributes and proxy variables from model inputs |
| Description | Audit all features used in scoring; remove name, gender, age, ethnicity, postcode, and any variables correlated with protected characteristics. Retrain model after removal. |

Click **Add mitigation**, then add a second:

| Field | Value |
|---|---|
| Hierarchy level | Mitigate |
| Title | Quarterly third-party bias audit with demographic parity testing |
| Description | Commission independent bias audit each quarter. Reject and retrain any model version that fails demographic parity at >3% gap threshold. |

**Residual risk for Risk 1:**
- Residual likelihood: **Unlikely**
- Residual severity: **Low**

### Mitigation for Risk 2 — Lack of explainability

| Field | Value |
|---|---|
| Hierarchy level | Mitigate |
| Title | SHAP-based per-decision explanation report for every score |
| Description | Generate SHAP feature importance report for every performance score. Make it accessible to the employee and their manager. Retain reports for 3 years for audit purposes. |

**Residual risk for Risk 2:**
- Residual likelihood: **Unlikely**
- Residual severity: **Low**

Click **Next**.

---

## Step 5 — Plan

**What to say:** *"Before approving, the cycle requires a concrete action plan: a scheduled review date and a list of tasks linked to specific risks. Tasks have owners and deadlines — overdue tasks automatically create a re-assessment trigger."*

### Review date

Set the **Scheduled review date** to 3 months from today (must be within 6 months).

**What to say:** *"The 6-month maximum enforces Art. 9(1)'s iterative monitoring requirement — you cannot approve and forget for more than half a year."*

### Tasks

Click **+ Add task** and fill in:

| Field | Value |
|---|---|
| Task title | Complete Q3 bias audit |
| Description | Run the quarterly demographic parity report. Compare acceptance rates across gender, age, and ethnicity. Escalate to HR Director if parity gap >3%. |
| Linked risk | Biased performance scoring against protected employee groups |
| Assigned to | hr.director@company.com |
| Due date | 30 days from today |
| Status | In progress |

Click **Save task**, then add a second task:

| Field | Value |
|---|---|
| Task title | Verify SHAP reports are generated for all decisions |
| Description | Audit 50 recent score records to confirm SHAP reports are present and accessible to employees. |
| Linked risk | Lack of explainability for low performance scores |
| Assigned to | hr.director@company.com |
| Due date | 45 days from today |
| Status | Open |

Click **Next: Approve →**.

---

## Step 6 — Approve

**What to say:** *"The final step requires a responsible person to sign off on the overall residual risk. Under Art. 9(5), someone with authority must confirm the risk is acceptable before the system can be put into service. You can also record any incidents — situations where a risk actually materialized."*

### Report an incident (optional demonstration)

Click **+ Report incident** and fill in:

| Field | Value |
|---|---|
| Incident title | Performance scores flagged as potentially biased for part-time employees |
| Description | Three managers independently reported that part-time employees scored significantly lower than full-time peers with equivalent output metrics. Suspected training data imbalance. |
| Linked risk | Biased performance scoring against protected employee groups |
| Reported by | hr.director@company.com |
| Date occurred | (today's date) |
| Attachments | Manager feedback forms (3x PDF)\nSample score comparison spreadsheet |
| Status | Under investigation |

Click **Report incident**.

Then add a follow-up task to this incident by clicking **+ Add task** under the incident:

| Field | Value |
|---|---|
| Task title | Investigate part-time bias in training data |
| Description | Pull training data split by employment type. Check whether part-time label or correlated features drove the score gap. Report findings to HR Director within 2 weeks. |
| Assigned to | ml.engineer@company.com |
| Due date | 14 days from today |

### Sign off

| Field | Value |
|---|---|
| Residual risk acceptable | ✓ Yes |
| Expert sign-off argument | Residual risk is acceptable following implementation of bias elimination controls and mandatory explainability reporting. Quarterly independent audits ensure ongoing compliance. The system must not be deployed until the bias audit and SHAP reporting are implemented and verified. |

Click **Approve**.

---

## After approval

**What to say:** *"Once approved, the assessment is locked in read-only mode — you can browse all steps but cannot edit them. This is the audit trail. The Export Report button generates a printable HTML summary for regulators or internal audit. Incidents remain visible and editable even after approval — you can continue to log and investigate them."*

- Click **Export report** and show the generated document.
- Point out the green **Approved** banner and the locked steps.
- Scroll down to show that this first cycle is now stored as version 1.
- Show the Incidents card with the reported incident and its linked follow-up task.

---

## What this demonstrates

| Wizard step | EU AI Act obligation |
|---|---|
| Scope | Art. 9(2)(a) — define what is assessed |
| Identify | Art. 9(2)(a) — known and foreseeable risks; Art. 9(9) — vulnerable groups |
| Evaluate | Art. 9(2)(b) — decide which risks to address; review risk descriptions |
| Mitigate | Art. 9(2)(b)+(c) — mitigation hierarchy; Art. 9(2)(d) — residual risk |
| Plan | Art. 9(1) — iterative monitoring; scheduled review date ≤6 months; task tracking with owners and deadlines |
| Approve | Art. 9(5) — expert sign-off; Art. 9(12) — documentation; incident recording |
