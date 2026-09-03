# Risk Management — Demo Guide

## Quick start with demo data

The platform ships with an optional demo seed that registers 5 diverse AI systems and fully populates their risk registers so the Risk Management module is ready to demonstrate immediately after install.

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

The only values you may want to change are `APP_ADMIN_USERNAME` / `APP_ADMIN_PASSWORD` (the login you'll use at `http://localhost:8080`). Everything else works as-is.

### 3. Start the platform and seed demo data

```bash
# Start everything
docker compose up -d

# Seed 5 demo AI systems with full risk registers (safe to re-run)
docker compose --profile demo up risk-management-demo-seed
```

Wait for the seed container to exit (`Exited (0)`), then open [http://localhost:8080](http://localhost:8080) and log in with `APP_ADMIN_USERNAME` / `APP_ADMIN_PASSWORD` from your `.env` (defaults: `admin` / `password`).

Navigate to **Risk Management** in the sidebar.

### What the seed creates

| System | EU AI Act Tier | Assessment versions | Status |
|---|---|---|---|
| HR Candidate Screening AI | **HIGH** (employment) | 4 | ✓ Up to date |
| Credit Risk Assessment Model | **HIGH** (credit scoring) | 3 | ⚠ Restart due (unacknowledged trigger) |
| Customer Support Chatbot | **LIMITED** (chatbot) | 2 | ⚠ Overdue (>6 months) |
| Medical Image Diagnosis Assistant | MINIMAL | 2 approved + 1 in progress | Resume |
| Social Scoring Pilot | **PROHIBITED** (Art. 5(1)(c)) | 1 | ✓ Approved (not acceptable) |

### Configuration

| Variable | Default | Description |
|---|---|---|
| `SEED_ADMIN_USERNAME` | `admin` | Username used as the assessor/approver in demo data |

Set in `.env` if your admin account has a different name.

---

## Exploring the module

### Systems list

Open **Risk Management** in the sidebar. You'll see:

- **Status dot** — green = up to date, red = action needed
- **Action button** colours:
  - 🟢 **Start** — no assessment exists yet
  - 🔵 **Open** — assessment exists and is current
  - 🟠 **Resume** — assessment started but not yet approved
  - 🔴 **Restart** — re-assessment triggered (>6 months or system changed)
- **Trigger badge** — "1 trigger(s)" with ⓘ tooltip explaining what triggers are
- **Overdue badge** — ">6 months" with ⓘ tooltip citing Art. 9(1)

### Assessment wizard (5 steps)

1. **Scope** — define what this assessment covers (Art. 9(2)(a))
2. **Identify** — add risks with severity/likelihood matrix, auto-calculated risk level badge, lifecycle phase, owner, vulnerable groups (Art. 9(9))
3. **Evaluate** — confirm or dismiss each identified risk
4. **Mitigate** — add mitigation measures in hierarchy order: Eliminate → Reduce → Mitigate → Inform (Art. 9(2)(b)+(c)); record residual risk
5. **Approve** — summary, residual risk argument (Art. 9(5)), approve

After approval:
- All steps remain browsable in read-only mode (green "Approved" banner)
- **Export report** button generates a printable HTML report
- **Restart** button (when reassessment is due) starts a new cycle pre-filled from the previous one

### Versioning

Previous assessment cycles appear as collapsed cards below the active wizard. Each card shows the approval date, confirmed risk count, and residual risk verdict. Click to expand for full detail.

---

## Prompt for Claude — interactive walkthrough

See [`DEMO_PROMPT.md`](DEMO_PROMPT.md) for a self-contained prompt you can paste into Claude to get a guided, step-by-step walkthrough of the Risk Management module.
