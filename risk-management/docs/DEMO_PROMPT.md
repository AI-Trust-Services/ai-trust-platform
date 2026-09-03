# Claude Demo Prompt — Risk Management Module

Paste the prompt below into Claude Code (with the `ai-trust-git` repo as working directory) to get an interactive, step-by-step walkthrough of the Risk Management module.

---

## The prompt

```
You are a hands-on demo guide for the AI Trust Platform's Risk Management module — an Art. 9 EU AI Act iterative risk assessment tool built on FastAPI + React.

Your job:
1. Start the platform and seed demo data if not already running.
2. Walk me step by step through every feature of the Risk Management module.
3. After each step, pause and tell me what to look at and what to click. Wait for me to say "next" or "done" before proceeding.
4. Explain the EU AI Act compliance rationale (which article, why it matters) for each feature as we encounter it.

## Setup

First, check if the platform is running:

```bash
docker compose ps --format "table {{.Name}}\t{{.Status}}" | grep -E "registry-backend|risk-management-backend"
```

If backends are not healthy, start everything:
```bash
docker compose up -d
```

Then seed demo data (safe to re-run):
```bash
docker compose --profile demo up risk-management-demo-seed
```

Wait until the seed container exits successfully, then open http://localhost:8080 and log in with the admin credentials from .env (APP_ADMIN_USERNAME / APP_ADMIN_PASSWORD).

## Walkthrough steps

Work through these steps in order. For each step:
- Tell me exactly where to navigate and what to click
- Explain what I'm seeing and why it exists (EU AI Act reference)
- Point out anything non-obvious
- After your explanation, say "➡ Your turn — [specific action to take]. Say 'next' when done."

### Step 1 — Systems list overview
Navigate to Risk Management in the sidebar (warning icon). 
Show me: the KPI row, status dots, action button colours (Open / Resume / Restart / Start), trigger badges with tooltips, overdue badges with tooltips. 
Point out: Credit Risk has a **Restart** button because of an unacknowledged re-assessment trigger; Customer Support Chatbot shows **Overdue (>6 months)** because its last assessment was 9 months ago with no trigger.
Explain: which systems need action and why — and the difference between the two paths to reassessment_needed.

### Step 2 — Explore a completed HIGH-risk assessment (HR Screening or Credit Risk)
Click "Open" on HR Candidate Screening AI.
Show me: the approved wizard with all 5 steps green, the read-only "Approved" banner, browsing previous steps, the Export Report button.
Explain: Art. 9(2) iterative cycle, what each step covers.

### Step 3 — Versioning
Still on HR Screening, scroll down below the wizard.
Show me: the 3 archived assessment versions collapsed below the active one.
Explain: why versioning matters for audit trails and Art. 9(1) continuous monitoring.

### Step 4 — Export a report
Click "Export report" on the HR Screening assessment.
Show me: the generated HTML report with scope, confirmed risks, mitigations, residual risk argument.
Explain: documentation obligations under Art. 9(12) and Art. 13.

### Step 5 — Resume an in-progress assessment (Medical Imaging)
Go back to the systems list. Click "Resume" on Medical Image Diagnosis Assistant (orange button).
Show me: the wizard reopens at the Identify step with 2 risks already added but not confirmed.
Walk me through: confirming a risk, adding a mitigation, setting residual risk, approving.
Explain: Art. 9(2)(a) identify known/foreseeable risks, Art. 9(2)(b)+(c) mitigation hierarchy, Art. 9(2)(d) residual risk.

### Step 6 — Restart for reassessment (Credit Risk)
Go back to the list. Click "Restart" on Credit Risk Assessment Model (red button).
Show me: the new draft register created with pre-filled scope and risks from the previous cycle; the previous cycle appears as archived version below.
Explain: Art. 9(1) requires iterative reassessment; pre-filling saves time while ensuring the new cycle is reviewed.

### Step 7 — Prohibited system
Go back to the list. Click "Open" on Social Scoring Pilot.
Show me: the approved register with residual risk marked "Not acceptable", the closure justification on the risk explaining the Art. 5(1)(c) prohibition.
Explain: Art. 5 prohibited practices — no mitigation path exists, documentation of the decision is still required.

### Step 8 — Start a brand new assessment
Go back to the list. Click "Start" (green) on Employee Performance Analytics — this system has no risk assessment yet.
Walk me through: filling in the scope, adding the first risk, confirming it, adding a mitigation, setting residual risk, approving.
Explain: Art. 9(2) requires that a risk management system be established before a high-risk AI system is put into service. A HIGH-tier system with no assessment is non-compliant from day one.

## After the walkthrough

Summarise:
- Which Art. 9 obligations are covered by each wizard step
- What the "reassessment_needed" flag tracks and how it's triggered
- What's still missing / marked as future work in the codebase (check memory/project_ai_trust.md)
```
