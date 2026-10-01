# Risk Management — Demo Guide

## Quick start with demo data

The platform ships with an optional demo seed that registers 11 diverse AI systems (including two
deliberate registry edge cases) and fully populates their risk registers so the Risk Management
module is ready to demonstrate immediately after install.

### 1. Clone the repository

```bash
git clone https://github.com/AI-Trust-Services/ai-trust-platform.git
cd ai-trust-platform
git checkout jw-poc-risk-management
```

### 2. Create `.env`

Copy the example file — all defaults work for a local demo install:

```bash
cp .env.example .env
```

The only values you may want to change are `APP_ADMIN_USERNAME` / `APP_ADMIN_PASSWORD` (the login
you'll use at `http://localhost:8080`). Everything else works as-is.

### 3. Start the platform and seed demo data

```bash
# Start everything
docker compose up -d

# Seed 11 demo AI systems with full risk registers (safe to re-run)
docker compose --profile demo up risk-management-demo-seed
```

Wait for the seed container to exit (`Exited (0)`), then open [http://localhost:8080](http://localhost:8080)
and log in with `APP_ADMIN_USERNAME` / `APP_ADMIN_PASSWORD` from your `.env` (defaults: `admin` /
`Admin1234!`).

Navigate to **Risk Management** in the sidebar.

### Role accounts needed for live per-role confirmation

Per-role risk confirmation is permission-gated: only a user holding the **AI Engineer** role can
confirm an AI Engineer sign-off, and only a user holding the **AI Compliance Officer** role can
confirm a Compliance Officer sign-off — there is no "general" or admin override. The seed script
confirms risks as the real role holders (not as a general approver), using these usernames:

| Variable | Default | Must hold role |
|---|---|---|
| `SEED_ADMIN_USERNAME` | `admin` | Platform Administrator — used for all non-role-gated writes (creating systems, risks, residual risk fields, register approval) |
| `SEED_ENGINEER_USERNAME` | `ai_engineer` | AI Engineer |
| `SEED_OFFICER_USERNAME` | `compliance-officer` | AI Compliance Officer |

**These two accounts are not created automatically anywhere in the stack.** If they don't already
exist, create them once before seeding: **IAM** (sidebar) → **Add User** → set the username and
assign the matching role. If they're missing, the seed script's confirm calls fail with HTTP 403
and the seed aborts. Set the variables in `.env` first if your accounts use different names.

### What the seed creates

| System | EU AI Act Tier | Status |
|---|---|---|
| HR Candidate Screening AI | **HIGH** (employment) | Green — approved, all risks fully confirmed |
| Credit Risk Assessment Model | **HIGH** (credit scoring) | Red — unacknowledged reassessment trigger |
| Customer Support Chatbot | **LIMITED** (chatbot) | Orange — approved register stale (>6 months) |
| Loan Approval Automation | **HIGH** (credit scoring) | Red — approved register overdue (>6 months) |
| Medical Image Diagnosis Assistant | **HIGH** (critical infrastructure) | Orange — in-progress draft register |
| Social Scoring Pilot | **PROHIBITED** (Art. 5(1)(c)) | Red — no mitigation path exists for a prohibited system |
| Employee Performance Analytics | **HIGH** (employment) | Red — no register yet (the `DEMO_WALKTHROUGH_EPA.md` starting point) |
| Internal Knowledge Base Search | MINIMAL | Green — no register needed |
| Meeting Transcription Tool | MINIMAL | Green — voluntary register, approved and confirmed |
| Internal Analytics Dashboard | *(pending)* | Orange — registry has not classified this system's tier yet |
| Supplier Due Diligence Tool | MINIMAL | Green — `org_role` forced to NULL on this system, an edge case for incomplete registry data (does not affect the traffic light) |

The in-progress **Medical Image Diagnosis Assistant** register demonstrates all per-role
confirmation states at once: both roles pending, AI Engineer confirmed / Compliance Officer
pending, AI Engineer confirmed / Compliance Officer declined ("not my decision"), and two
single-role-only risks (Compliance Officer only, AI Engineer only). See
[`DEMO_WALKTHROUGH_EPA.md`](DEMO_WALKTHROUGH_EPA.md) Part 2 for a guided tour.

### Known issues on a new machine

**MinIO images removed from Docker Hub**

`minio/minio` and `minio/mc` have been removed from Docker Hub by MinIO. On a machine with no local
image cache, `docker compose up -d` will fail with:

```
pull access denied for minio/minio, repository does not exist or may require 'docker login'
pull access denied for minio/mc, repository does not exist or may require 'docker login'
```

Fix: create a `docker-compose.override.yml` in the repo root with the following content (this file
is already in `.gitignore` and will not be committed):

```yaml
services:
  minio:
    image: quay.io/minio/minio:RELEASE.2025-09-07T16-13-09Z
  minio-init:
    image: quay.io/minio/mc:RELEASE.2025-08-13T08-35-41Z
```

Docker automatically merges this file with `docker-compose.yml`. If the MinIO version in
`docker-compose.yml` changes in the future, update the tags above accordingly.

**Docker CLI not in PATH on macOS**

Docker Desktop installs its CLI to `~/.docker/bin/`, which is not in the default PATH on macOS. If
`docker` is not found, add this to `~/.zshrc`:

```bash
export PATH="$HOME/.docker/bin:$PATH"
```

---

## Exploring the module

### Systems list

Open **Risk Management** in the sidebar. Two tabs: **Risk Management** (the systems list below) and
**Risk Library** (predefined, reusable risks you can import into any system).

On the systems list you'll see:

- **KPI tiles** (Total / High Risk / Action Required / In Progress / Completed) — click to filter
- **Status** (traffic light dot) — green = up to date / not needed, red = action required, orange =
  in progress
- **System**, **Risk Classification** (EU AI Act tier badge), **Last Management Review**, **Valid
  Until** columns — all sortable by clicking the header
- **Status** (text column) — e.g. "No risks added", "Risks pending review", "Pending approval",
  "Overdue", "Review due", "Residual risk unacceptable", "Risks unconfirmed", "Completed", or "Not
  initiated"; a "Risk management voluntary" note appears for non-HIGH tiers, "Cannot be placed on
  the EU market" for prohibited systems
- **Action** button — **Start** (no register yet), **Resume** (register in progress), **Open**
  (approved and current), or **Review** (approved but the traffic light is red, e.g. an overdue or
  triggered reassessment)

### The assessment page (single scrollable page, not a wizard)

Clicking a system's action button opens its assessment page. It is **one continuous page with
ordered sections** — there is no step counter and no "Next" button:

1. **Risk Management Scope** — read-only summary pulled from the AI System Registry (system name,
   description, intended purpose, tier, lifecycle, and other populated registry fields)
2. **Identified risks** — sortable list (by title, category, severity, criticality/likelihood, risk
   level, risk owner, responsible role, deadline, or approval status); add, edit, or delete risks;
   each risk expands to show its evaluation fields, per-role confirmation bar, mitigations (grouped
   Eliminate → Reduce → Mitigate → Inform), residual risk, misuse scenarios, linked tasks,
   incidents, and test reports
3. **Action plan** — plan tasks not linked to a specific risk (toggle "Show all tasks" to see every
   task); approval is blocked until every mitigation required by a risk's residual status has a
   linked task (see the Risk evaluation & confirmation note above)
4. **Review** — **Reviewer** (defaults to the current user's email) and **Scheduled review date**
   (must be within 6 months)
5. **Overall residual risk** — acceptability verdict and sign-off argument for the register as a
   whole
6. **Incidents** — manual incident log with a "Report incident" form, linkable to a specific risk
   (toggle "Show all incidents" to see every incident, including ones linked to a risk)
7. **Approve** — blocked with a specific error message until every required field and gate above is
   satisfied

See [`DEMO_WALKTHROUGH_EPA.md`](DEMO_WALKTHROUGH_EPA.md) for the full field-by-field walkthrough.

After approval:
- The page locks to read-only (green "Approved" banner)
- **Export report** generates a printable HTML report
- The **Incidents** section stays editable — log and track situations where risks materialized
- Once a reassessment is due, the action button becomes **Review** and a new cycle can be started,
  pre-filled from the previous one

### Versioning

Previous assessment cycles appear as collapsed cards below the active register. Each card shows the
approval date, confirmed risk count, residual risk verdict, and a diff badge showing how many
changes were made going into the next cycle. Click to expand for full field-level detail per risk.

### Risk Library

The **Risk Library** tab lists predefined, reusable risks (title, description, category, severity,
likelihood, suggested mitigation). From there you can add a risk to any system, or add a new entry
directly. From a system's **Add risk** form, use **Import from library** to pre-fill a new risk, or
**Save & upload to library** to contribute a new risk back — the latter is disabled (greyed out,
with an explanatory tooltip) when the platform administrator has turned the Risk Library setting
off.

---

## Prompt for an AI assistant — interactive walkthrough

See [`DEMO_PROMPT.md`](DEMO_PROMPT.md) for a self-contained prompt you can paste into an AI coding
assistant (e.g. GitHub Copilot CLI, Claude Code) to get a guided, step-by-step walkthrough of the
Risk Management module.
