"""
Risk Management demo seed.

Creates diverse AI systems in the registry and fully populates their risk
registers to demonstrate all risk management module features:

  - Confirmed risks with residual_status: none / acceptable / unacceptable
  - Register-level residual risk (severity × likelihood, date, argument)
  - Approval gate: unacceptable residual requires a linked plan task
  - Monitoring-sourced risks (source="monitoring")
  - Dismissed risks with closure_justification
  - Multi-version registers (4 cycles HR, 3 cycles Credit Risk, etc.)
  - In-progress register (risks identified, not yet approved)
  - PROHIBITED system with not-acceptable residual
  - Incidents and plan tasks
  - Voluntary risk management for minimal-risk system

Run via docker compose:
  docker compose --profile demo up risk-management-demo-seed

Or directly (requires REGISTRY_API_BASE and RISK_API_BASE env vars):
  python seed.py
"""

import json
import os
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone

REGISTRY_BASE = os.environ.get("REGISTRY_API_BASE", "http://ai-system-registry-backend:8001")
RISK_BASE = os.environ.get("RISK_API_BASE", "http://risk-management-backend:8009")
ADMIN = os.environ.get("SEED_ADMIN_USERNAME", "admin")

HEADERS = {
    "X-Forwarded-Preferred-Username": ADMIN,
    "Content-Type": "application/json",
}


def _req(base, path, method="GET", body=None, *, retries=5, delay=3):
    url = f"{base}{path}"
    data = json.dumps(body).encode() if body is not None else None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, data=data, method=method, headers=HEADERS)
            with urllib.request.urlopen(req, timeout=10) as r:
                if r.status == 204:
                    return {}
                return json.loads(r.read())
        except urllib.error.HTTPError as e:
            err = e.read().decode()[:300]
            if e.code == 409:
                return {}
            print(f"  HTTP {e.code} {method} {url}: {err}", file=sys.stderr)
            raise
        except Exception as exc:
            if attempt < retries - 1:
                print(f"  Retrying {url} ({exc})…", file=sys.stderr)
                time.sleep(delay)
            else:
                raise


def wait_for_services():
    print("Waiting for registry and risk-management backends…")
    for base, path in [
        (REGISTRY_BASE, "/health"),
        (RISK_BASE, "/health"),
    ]:
        for _ in range(30):
            try:
                _req(base, path)
                print(f"  {base} ✓")
                break
            except Exception:
                time.sleep(3)
        else:
            print(f"  ERROR: {base} did not become healthy", file=sys.stderr)
            sys.exit(1)


def register_system(payload) -> str:
    result = _req(REGISTRY_BASE, "/v1/intake", "POST", payload)
    sys_id = result["system"]["id"]
    print(f"  Registered {sys_id} ({result['system']['tier'].upper()}) — {result['system']['name']}")
    return sys_id


def _reclassify_put(sys_id, flags: dict):
    """PUT full system record with updated flags (strips read-only fields)."""
    sys_data = _req(REGISTRY_BASE, f"/v1/systems/{sys_id}")
    sys_data.update(flags)
    for k in ("id", "tier", "basis", "annex_iii_area", "classification_rationale",
               "created_at", "updated_at", "field_confirmations"):
        sys_data.pop(k, None)
    _req(REGISTRY_BASE, f"/v1/systems/{sys_id}", "PUT", sys_data)


def create_register(sys_id, scope, notes="") -> str:
    reg = _req(RISK_BASE, f"/v1/systems/{sys_id}/registers", "POST",
               {"assessment_scope": scope, "notes": notes})
    return reg["id"]


def add_risk(reg_id, **fields) -> str:
    """Add a risk. Pass residual_status='acceptable'|'unacceptable'|'none' explicitly."""
    r = _req(RISK_BASE, f"/v1/registers/{reg_id}/risks", "POST", fields)
    return r["id"]


def confirm_risk(risk_id, residual_status="acceptable",
                 residual_likelihood=None, residual_severity=None,
                 date_of_assessment=None, review_notes="", confirmed=False):
    patch = {
        "status": "confirmed",
        "residual_status": residual_status,
        "review_notes": review_notes,
    }
    if residual_likelihood:
        patch["residual_likelihood"] = residual_likelihood
    if residual_severity:
        patch["residual_severity"] = residual_severity
    if date_of_assessment:
        patch["date_of_assessment"] = date_of_assessment
    if confirmed:
        patch["engineer_confirmed"] = True
        patch["officer_confirmed"] = True
    _req(RISK_BASE, f"/v1/risks/{risk_id}", "PATCH", patch)


def dismiss_risk(risk_id, justification):
    _req(RISK_BASE, f"/v1/risks/{risk_id}", "PATCH", {
        "status": "dismissed",
        "closure_justification": justification,
        "residual_status": "none",
    })


def add_misuse_scenario(risk_id, actor, description, likelihood, consequence, vulnerable_group=None):
    _req(RISK_BASE, f"/v1/risks/{risk_id}/misuse-scenarios", "POST", {
        "actor": actor,
        "description": description,
        "likelihood": likelihood,
        "consequence": consequence,
        "vulnerable_group": vulnerable_group,
    })


def add_mitigation(risk_id, hierarchy_level, title, description="",
                   implementation_guidance="", assigned_to=None, due_date=None) -> str:
    r = _req(RISK_BASE, f"/v1/risks/{risk_id}/mitigations", "POST", {
        "title": title, "description": description,
        "hierarchy_level": hierarchy_level,
        "implementation_guidance": implementation_guidance,
        "status": "planned",
        "assigned_to": assigned_to,
        "due_date": due_date,
        "override_notes": "",
    })
    return r["id"]


def add_plan_task(reg_id, title, description="", risk_id=None, mitigation_id=None,
                  assigned_to=None, due_date=None, status="open"):
    _req(RISK_BASE, f"/v1/registers/{reg_id}/plan-tasks", "POST", {
        "title": title, "description": description,
        "risk_id": risk_id, "mitigation_id": mitigation_id,
        "assigned_to": assigned_to,
        "due_date": due_date, "status": status,
    })


def add_incident(reg_id, title, description="", risk_id=None, reported_by=None,
                 occurred_at=None, status="open"):
    return _req(RISK_BASE, f"/v1/registers/{reg_id}/incidents", "POST", {
        "title": title, "description": description, "risk_id": risk_id,
        "reported_by": reported_by, "occurred_at": occurred_at,
        "attachments": "", "status": status,
    })


def set_review_date(reg_id, iso_date: str):
    _req(RISK_BASE, f"/v1/registers/{reg_id}", "PATCH", {"next_review_date": iso_date})


def save_reg_residual(reg_id, acceptable: bool | None,
                      severity=None, likelihood=None, date=None, argument=""):
    """Save register-level residual risk fields (without approving)."""
    patch = {
        "residual_risk_acceptable": acceptable,
        "residual_risk_argument": argument,
    }
    if severity:
        patch["residual_severity"] = severity
    if likelihood:
        patch["residual_likelihood"] = likelihood
    if date:
        patch["residual_date_of_identification"] = date
    _req(RISK_BASE, f"/v1/registers/{reg_id}", "PATCH", patch)


def approve_register(reg_id, acceptable: bool | None, argument: str,
                     severity=None, likelihood=None, date=None):
    """Approve the register, including register-level residual risk fields."""
    reg = _req(RISK_BASE, f"/v1/registers/{reg_id}")
    if not reg.get("next_review_date"):
        fallback = (datetime.now(timezone.utc) - timedelta(days=90)).strftime("%Y-%m-%d")
        set_review_date(reg_id, fallback)

    body = {
        "residual_risk_acceptable": acceptable,
        "residual_risk_argument": argument,
    }
    _req(RISK_BASE, f"/v1/registers/{reg_id}/approve", "POST", body)

    # Patch register-level residual risk matrix fields after approval
    patch = {}
    if severity:
        patch["residual_severity"] = severity
    if likelihood:
        patch["residual_likelihood"] = likelihood
    if date:
        patch["residual_date_of_identification"] = date
    if patch:
        _req(RISK_BASE, f"/v1/registers/{reg_id}", "PATCH", patch)


def _today() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def _days_from_now(n: int) -> str:
    return (datetime.now(timezone.utc) + timedelta(days=n)).strftime("%Y-%m-%dT%H:%M:%SZ")


def _days_ago(n: int) -> str:
    return (datetime.now(timezone.utc) - timedelta(days=n)).strftime("%Y-%m-%dT%H:%M:%SZ")


def main():
    wait_for_services()

    existing = _req(REGISTRY_BASE, "/v1/systems?limit=1")
    count = len(existing) if isinstance(existing, list) else existing.get("total", existing.get("count", 0))
    if count > 0:
        print("\n⚠ Systems already exist in the registry — skipping seed to avoid duplicates.")
        print("  To re-seed: run the cleanup SQL first (see DEMO_GUIDE.md).")
        return

    print("\n── Registering AI systems ──")

    # ── 1. HR Candidate Screening AI (HIGH) ──────────────────────────────────
    hr_id = register_system({
        "name": "HR Candidate Screening AI",
        "description": "Automated CV screening and candidate ranking for recruitment.",
        "assignee_username": ADMIN, "lifecycle": "operation",
        "intended_purpose": "Screen and rank job applicants based on CV content and job requirements",
        "department": "Human Resources",
        "is_employment_related": True,
        "annex_iii_flags": [], "art_5_flags": [],
        "is_gpai": False, "is_chatbot": False, "generates_synthetic_content": False,
        "training_compute_flops": 0,
    })
    _reclassify_put(hr_id, {"is_employment_related": True})

    # ── 2. Credit Risk Assessment Model (HIGH) ────────────────────────────────
    cr_id = register_system({
        "name": "Credit Risk Assessment Model",
        "description": "Scores loan applicants and determines creditworthiness for retail banking.",
        "assignee_username": ADMIN, "lifecycle": "operation",
        "intended_purpose": "Evaluate credit risk and approve/reject loan applications automatically",
        "department": "Risk Management",
        "is_credit_scoring": True,
        "annex_iii_flags": [], "art_5_flags": [],
        "is_gpai": False, "is_chatbot": False, "generates_synthetic_content": False,
        "training_compute_flops": 0,
    })
    _reclassify_put(cr_id, {"is_credit_scoring": True})

    # ── 3. Customer Support Chatbot (LIMITED) ─────────────────────────────────
    cs_id = register_system({
        "name": "Customer Support Chatbot",
        "description": "LLM-powered chatbot handling tier-1 customer support queries 24/7.",
        "assignee_username": ADMIN, "lifecycle": "operation",
        "intended_purpose": "Answer customer questions and resolve common issues without human intervention",
        "department": "Customer Experience",
        "annex_iii_flags": [], "art_5_flags": [],
        "is_gpai": False, "is_chatbot": True, "generates_synthetic_content": False,
        "training_compute_flops": 0,
    })
    _reclassify_put(cs_id, {"is_chatbot": True})

    # ── 4. Medical Image Diagnosis Assistant (HIGH) ───────────────────────────
    md_id = register_system({
        "name": "Medical Image Diagnosis Assistant",
        "description": "Assists radiologists in detecting anomalies in chest X-rays and CT scans.",
        "assignee_username": ADMIN, "lifecycle": "testing",
        "intended_purpose": "Flag potential pathologies in medical images to support radiologist review",
        "department": "MedTech R&D",
        "annex_iii_flags": [], "art_5_flags": [],
        "is_gpai": False, "is_chatbot": False, "generates_synthetic_content": False,
        "training_compute_flops": 0,
    })
    _reclassify_put(md_id, {"is_critical_infrastructure": True})

    # ── 5. Social Scoring Pilot (PROHIBITED) ─────────────────────────────────
    ss_id = register_system({
        "name": "Social Scoring Pilot",
        "description": "Pilot evaluating citizen behaviour scores for municipal service prioritisation.",
        "assignee_username": ADMIN, "lifecycle": "development",
        "intended_purpose": "Score citizens based on behavioural data to prioritise public service access",
        "department": "Public Sector Innovation",
        "annex_iii_flags": [], "art_5_flags": [],
        "is_gpai": False, "is_chatbot": False, "generates_synthetic_content": False,
        "training_compute_flops": 0,
    })
    _reclassify_put(ss_id, {"social_scoring_public": True})

    # ── 6. Employee Performance Analytics (HIGH) — no register ───────────────
    epa_id = register_system({
        "name": "Employee Performance Analytics",
        "description": "Analyses employee productivity metrics and flags underperformers for HR review.",
        "assignee_username": ADMIN, "lifecycle": "development",
        "intended_purpose": "Support HR decisions on performance reviews and promotions",
        "department": "Human Resources",
        "is_employment_related": True,
        "annex_iii_flags": [], "art_5_flags": [],
        "is_gpai": False, "is_chatbot": False, "generates_synthetic_content": False,
        "training_compute_flops": 0,
    })
    _reclassify_put(epa_id, {"is_employment_related": True})
    # No risk register — demonstrates green "Start" button

    # ── 7. Loan Approval Automation (HIGH) ───────────────────────────────────
    la_id = register_system({
        "name": "Loan Approval Automation",
        "description": "Automates approval and rejection of retail loan applications using ML scoring.",
        "assignee_username": ADMIN, "lifecycle": "operation",
        "intended_purpose": "Speed up loan decisioning for retail banking customers",
        "department": "Retail Banking",
        "is_credit_scoring": True,
        "annex_iii_flags": [], "art_5_flags": [],
        "is_gpai": False, "is_chatbot": False, "generates_synthetic_content": False,
        "training_compute_flops": 0,
    })
    _reclassify_put(la_id, {"is_credit_scoring": True})

    # ── 8. Internal Knowledge Base Search (MINIMAL) — no register ────────────
    kb_id = register_system({
        "name": "Internal Knowledge Base Search",
        "description": "AI-powered semantic search over internal company documents and wikis.",
        "assignee_username": ADMIN, "lifecycle": "operation",
        "intended_purpose": "Help employees find relevant internal documentation faster",
        "department": "IT",
        "annex_iii_flags": [], "art_5_flags": [],
        "is_gpai": False, "is_chatbot": False, "generates_synthetic_content": False,
        "training_compute_flops": 0,
    })

    # ── 9. Meeting Transcription Tool (MINIMAL) ───────────────────────────────
    mtt_id = register_system({
        "name": "Meeting Transcription Tool",
        "description": "Transcribes and summarises recorded internal meetings using speech-to-text AI.",
        "assignee_username": ADMIN, "lifecycle": "operation",
        "intended_purpose": "Automatically generate meeting notes and action items from recordings",
        "department": "Operations",
        "annex_iii_flags": [], "art_5_flags": [],
        "is_gpai": False, "is_chatbot": False, "generates_synthetic_content": False,
        "training_compute_flops": 0,
    })
    _reclassify_put(mtt_id, {})

    print("\n── Creating risk registers ──")

    # ════════════════════════════════════════════════════════════════════════════
    # HR Screening — 4 versions demonstrating:
    #   v1-v3: archived multi-cycle history
    #   v4: latest cycle with full features (incidents, plan tasks, monitoring risk,
    #       dismissed risk, unacceptable residual with approval gate)
    # ════════════════════════════════════════════════════════════════════════════
    print("\nHR Screening (4 versions)…")
    SCOPE_HR = (
        "Assessment covers automated CV screening and candidate ranking for HR recruitment "
        "across all business units. Scope includes: training data bias, impact on protected "
        "characteristics (age, gender, ethnicity), transparency of scoring, human oversight, "
        "and Art. 9/10 EU AI Act compliance."
    )

    hr_regs = []

    for v in range(1, 5):
        scope = f"Assessment cycle {v}: {SCOPE_HR}" if v < 4 else SCOPE_HR
        reg = create_register(hr_id, scope)
        hr_regs.append(reg)

        bias_severity = "critical" if v >= 3 else "high"

        r1 = add_risk(reg,
            title="Discriminatory screening based on protected characteristics",
            description=(
                "The model may systematically score candidates from protected groups (age, gender, "
                "ethnicity) lower due to biased training data or proxy variables in CVs and applications."
            ),
            category="fundamental_rights",
            severity=bias_severity,
            likelihood="likely",
            risk_owner="hr.director@company.com",
            ai_lifecycle_phase="operation",
            affects_vulnerable_groups=True,
            vulnerable_groups='["women","ethnic minorities","older workers"]',
            impact="Systematic exclusion of candidates based on gender, age or ethnicity.",
        )
        add_misuse_scenario(r1,
            actor="Recruiter",
            description="Manually override AI score for candidates from specific demographic groups",
            likelihood="possible",
            consequence="Amplifies rather than reduces discriminatory outcomes",
            vulnerable_group="ethnic minorities",
        )
        m1a = add_mitigation(r1, "eliminate",
            "Exclude protected attributes from model inputs",
            "Remove name, gender, age, address from all training data and inference inputs.",
            implementation_guidance=(
                "Remove name, gender, age, postcode, and any proxy attributes from training "
                "data pipeline and inference inputs. Validated by data audit."
            ),
            assigned_to="hr.director@company.com",
        )
        m1b = add_mitigation(r1, "mitigate",
            "Monthly bias audit with demographic parity testing",
            "Run monthly fairness checks; reject model versions failing >5% parity gap.",
            implementation_guidance=(
                "Monthly fairness report comparing acceptance rates across gender, age band, ethnicity."
            ),
            assigned_to="hr.director@company.com",
        )
        # Required: every mitigation needs at least one plan task (mitigation_id)
        add_plan_task(reg, "Validate protected attribute exclusion in data pipeline",
            description="Audit data pipeline to confirm name, gender, age, postcode removed from all inputs.",
            risk_id=r1, mitigation_id=m1a,
            assigned_to="ml.engineer@company.com",
            due_date=_days_from_now(60), status="open")
        add_plan_task(reg, "Run bias audit — demographic parity report",
            description="Monthly fairness report: compare acceptance rates across gender, age band, ethnicity.",
            risk_id=r1, mitigation_id=m1b,
            assigned_to="hr.director@company.com",
            due_date=_days_from_now(30), status="open")

        # Residual: acceptable for v1-v3, unacceptable for v4 (demonstrates approval gate)
        if v < 4:
            confirm_risk(r1,
                residual_status="acceptable",
                residual_likelihood="unlikely",
                residual_severity="low",
                date_of_assessment=_days_ago((4 - v) * 60),
                review_notes=(
                    "Residual risk acceptable: protected attributes excluded from inputs "
                    "and monthly parity audits in place."
                ),
            )
        else:
            # v4: residual still UNACCEPTABLE — postcode proxy not yet removed
            confirm_risk(r1,
                residual_status="unacceptable",
                residual_likelihood="possible",
                residual_severity="moderate",
                date_of_assessment=_days_ago(5),
                review_notes=(
                    "Residual risk NOT acceptable. Postcode identified as proxy variable for ethnicity — "
                    "must be removed from feature set before next deployment window."
                ),
            )

        r2 = None
        if v >= 2:
            r2 = add_risk(reg,
                title="Lack of explainability for rejected candidates",
                description=(
                    "Candidates and hiring managers cannot understand why a score was assigned, "
                    "making it impossible to contest unfair rejections or identify systematic errors."
                ),
                category="fundamental_rights",
                severity="moderate",
                likelihood="likely",
                ai_lifecycle_phase="operation",
                impact="Candidates denied without explanation, violating GDPR Art. 22.",
            )
            add_misuse_scenario(r2,
                actor="Candidate",
                description="Deliberately omit personal details to game the scoring algorithm",
                likelihood="possible",
                consequence="Circumvents intended screening, unfair advantage",
            )
            m2a = add_mitigation(r2, "mitigate",
                "SHAP-based per-decision explanation report",
                "Generate SHAP feature importance report for every rejection; store 3 years.",
                implementation_guidance=(
                    "SHAP feature importance computed per inference call. "
                    "Report stored in candidate record for 3 years."
                ),
                assigned_to="hr.director@company.com",
            )
            add_plan_task(reg, "Audit SHAP explanation coverage for rejection decisions",
                description="Verify SHAP reports generated and stored for all rejection records.",
                risk_id=r2, mitigation_id=m2a,
                assigned_to="hr.director@company.com",
                due_date=_days_from_now(45), status="open")
            confirm_risk(r2,
                residual_status="acceptable",
                residual_likelihood="unlikely",
                residual_severity="low",
                date_of_assessment=_days_ago((4 - v) * 60 + 1),
                review_notes=(
                    "Residual risk acceptable: SHAP explanations satisfy GDPR Art. 22 requirement."
                ),
            )

        r3 = None
        if v >= 3:
            r3 = add_risk(reg,
                title="Excessive retention of candidate screening data",
                description=(
                    "Screening scores, CV data, and automated assessments are retained indefinitely "
                    "with no deletion schedule, exceeding the GDPR storage limitation principle."
                ),
                category="health",  # privacy mapped to health for demo
                severity="minor",
                likelihood="possible",
                ai_lifecycle_phase="operation",
                impact="Screening scores and CV data retained beyond GDPR storage limitation principle.",
            )
            m3a = add_mitigation(r3, "eliminate",
                "Automated deletion of candidate data after 24 months",
                "Scheduled job deletes screening records and CV data for non-hired candidates after 24 months.",
                implementation_guidance=(
                    "Nightly deletion job. Audit log retained separately for 5 years as required by employment law."
                ),
                assigned_to="privacy.officer@company.com",
            )
            add_plan_task(reg, "Verify automated deletion job is running in production",
                description="Confirm nightly deletion job executing and verify no records older than 24 months remain.",
                risk_id=r3, mitigation_id=m3a,
                assigned_to="privacy.officer@company.com",
                due_date=_days_from_now(30), status="open")
            confirm_risk(r3,
                residual_status="none",
                review_notes=(
                    "No residual risk: automated deletion fully eliminates the risk. "
                    "Deletion confirmed running in production."
                ),
            )

        # v4: monitoring-sourced risk + dismissed risk + plan tasks + incident
        if v == 4:
            # Monitoring-sourced risk (source="monitoring")
            r_mon = add_risk(reg,
                title="Score drift detected — acceptance rate anomaly",
                description=(
                    "Automated monitoring flagged a 12% drop in candidate acceptance rate "
                    "over the last 30 days with no corresponding change in applicant pool quality. "
                    "Possible model drift or data pipeline issue."
                ),
                category="others",
                severity="moderate",
                likelihood="possible",
                source="monitoring",
                ai_lifecycle_phase="operation",
                risk_owner="ml.engineer@company.com",
                impact="Unexplained acceptance rate change may indicate model degradation or data quality issue.",
            )
            m_mon = add_mitigation(r_mon, "mitigate",
                "Root cause investigation and model revalidation",
                "Investigate score drift root cause; retrain and revalidate model if data pipeline issue confirmed.",
                implementation_guidance=(
                    "Analyse upstream data pipeline for changes. Compare model score distribution "
                    "pre/post anomaly. Retrain if PSI > 0.15."
                ),
                assigned_to="ml.engineer@company.com",
            )
            add_plan_task(reg, "Investigate acceptance rate anomaly root cause",
                description="Analyse upstream data pipeline changes and model score distribution. Retrain if needed.",
                risk_id=r_mon, mitigation_id=m_mon,
                assigned_to="ml.engineer@company.com",
                due_date=_days_from_now(7), status="done")
            confirm_risk(r_mon,
                residual_status="acceptable",
                residual_likelihood="unlikely",
                residual_severity="minor",
                date_of_assessment=_days_ago(2),
                review_notes=(
                    "Root cause identified as upstream data pipeline change; model retrained and validated. "
                    "Residual risk acceptable."
                ),
            )

            # Dismissed risk (demonstrates dismiss flow)
            r_dis = add_risk(reg,
                title="Risk of AI system being used to screen out whistleblowers",
                description=(
                    "Theoretical scenario: hiring manager programs system to exclude candidates "
                    "with known whistleblower history via keyword filters."
                ),
                category="fundamental_rights",
                severity="severe",
                likelihood="unlikely",
                ai_lifecycle_phase="operation",
                impact="Potential misuse to discriminate against protected activities.",
            )
            m_dis = add_mitigation(r_dis, "eliminate",
                "Technical controls preventing keyword filter misuse",
                "Keyword filters disabled; system does not access employment history data.",
                implementation_guidance=(
                    "Architecture review confirms no access to employment history. "
                    "Keyword filter functionality removed from codebase."
                ),
                assigned_to="ml.engineer@company.com",
            )
            add_plan_task(reg, "Architecture review confirming no employment history access",
                description="Document that system cannot access employment history; remove keyword filter code.",
                risk_id=r_dis, mitigation_id=m_dis,
                assigned_to="ml.engineer@company.com",
                due_date=_days_from_now(14), status="done")
            dismiss_risk(r_dis,
                justification=(
                    "Risk dismissed: system does not have access to candidate employment history data. "
                    "Keyword filters are disabled. Technical architecture prevents this attack vector."
                ),
            )

            next_review = (datetime.now(timezone.utc) + timedelta(days=90)).strftime("%Y-%m-%d")
            set_review_date(reg, next_review)

            # Risk-level plan task demonstrating unacceptable residual (r1)
            add_plan_task(reg,
                "Remove postcode proxy variable from feature set",
                description=(
                    "Postcode identified as proxy variable for ethnicity in Q3 bias audit. "
                    "Remove from feature set, retrain model, and validate fairness metrics "
                    "before next monthly deployment window. Required to bring residual risk "
                    "back to acceptable level."
                ),
                risk_id=r1,
                assigned_to="ml.engineer@company.com",
                due_date=_days_from_now(14),
                status="in_progress",
            )

            # Incident on latest cycle
            add_incident(reg,
                "Bias detected in shortlisting for senior engineer roles",
                description=(
                    "Internal audit flagged that female candidates were shortlisted at 18% rate vs "
                    "34% for male candidates for senior engineer roles in Q2. Root cause: job description "
                    "language correlated with gender in training data."
                ),
                risk_id=r1,
                reported_by="hr.director@company.com",
                occurred_at=_days_ago(60),
                status="under_investigation",
            )
            add_incident(reg,
                "Candidate data export error — records sent to wrong recipient",
                description=(
                    "During scheduled reporting, 47 candidate screening records were included in "
                    "a report sent to an external recruiter who was not authorised to receive them."
                ),
                reported_by="privacy.officer@company.com",
                occurred_at=_days_ago(14),
                status="resolved",
            )

        if v < 4:
            historical_review = (datetime.now(timezone.utc) - timedelta(days=(4 - v) * 180)).strftime("%Y-%m-%d")
            set_review_date(reg, historical_review)
            approve_register(reg, True,
                "Residual risk is acceptable after implementation of bias audit and explainability controls. "
                "Monthly monitoring ensures ongoing compliance.",
                severity="minor",
                likelihood="unlikely",
                date=_days_ago((4 - v) * 60),
            )
            print(f"  v{v} approved ({reg})")
        else:
            # v4: unacceptable residual at register level (r1 is unacceptable)
            # Approval must include a linked task for the unacceptable risk (already added above)
            approve_register(reg, False,
                "Overall residual risk is NOT acceptable. Postcode proxy removal task is outstanding "
                "(assigned to ml.engineer, due in 14 days). Register approved pending task completion. "
                "Re-approve once bias mitigation is validated.",
                severity="moderate",
                likelihood="possible",
                date=_days_ago(3),
            )
            print(f"  v4 approved (unacceptable residual — approval gate demonstrated) ({reg})")

    # ════════════════════════════════════════════════════════════════════════════
    # Credit Risk — 3 versions
    # ════════════════════════════════════════════════════════════════════════════
    print("\nCredit Risk (3 versions)…")
    SCOPE_CR = (
        "Assessment covers automated creditworthiness scoring for retail lending: training "
        "data quality and representativeness, demographic bias risks, model accuracy and "
        "misclassification rates, impact on customers denied credit, human oversight of "
        "rejection decisions, and compliance with EU AI Act Art. 9 and Art. 10 obligations."
    )

    for v in range(1, 4):
        reg = create_register(cr_id, f"Cycle {v}: {SCOPE_CR}" if v < 3 else SCOPE_CR)

        r1 = add_risk(reg,
            title="Demographic bias in credit scoring leading to discriminatory decisions",
            description=(
                "The model may systematically assign lower creditworthiness scores to applicants "
                "from protected groups due to biased historical lending data or proxy variables "
                "such as postcode or employer type."
            ),
            category="fundamental_rights",
            severity="significant",
            likelihood="likely",
            risk_owner="risk.owner@company.com",
            ai_lifecycle_phase="operation",
            affects_vulnerable_groups=True,
            vulnerable_groups='["people in financial difficulty","ethnic minorities"]',
            impact="Customers from protected groups systematically denied credit.",
        )
        add_misuse_scenario(r1,
            actor="Loan officer",
            description="Use AI score to justify pre-determined rejection without review",
            likelihood="unlikely",
            consequence="Human oversight bypassed; discriminatory lending",
            vulnerable_group="people in financial difficulty",
        )
        cr1a = add_mitigation(r1, "reduce",
            "Fairness constraints in model training",
            "Apply demographic parity constraints; retrain quarterly.",
            implementation_guidance=(
                "Demographic parity constraint applied during model training via reweighting. "
                "Retrained quarterly with updated data."
            ),
            assigned_to="risk.owner@company.com",
        )
        cr1b = add_mitigation(r1, "mitigate",
            "Human review mandatory for all rejections",
            "All automated rejections require secondary human review.",
            implementation_guidance=(
                "Automated rejection flagged for secondary human review within 24h. "
                "Reviewer documents decision rationale."
            ),
            assigned_to="risk.owner@company.com",
        )
        add_plan_task(reg, "Quarterly model retraining with fairness constraints",
            description="Retrain model with updated data and demographic parity constraints; validate fairness metrics.",
            risk_id=r1, mitigation_id=cr1a, assigned_to="risk.owner@company.com",
            due_date=_days_from_now(90), status="open")
        add_plan_task(reg, "Audit human review process for automated rejections",
            description="Sample 50 rejections; confirm all have documented human review decision rationale.",
            risk_id=r1, mitigation_id=cr1b, assigned_to="risk.owner@company.com",
            due_date=_days_from_now(30), status="open")
        confirm_risk(r1,
            residual_status="acceptable",
            residual_likelihood="unlikely",
            residual_severity="moderate",
            date_of_assessment=_days_ago((3 - v) * 90 + 10),
            review_notes=(
                "Residual risk acceptable with mandatory human review for all rejections and quarterly "
                "bias audit. Demographic parity constraints limit model-level bias."
            ),
        )

        r2 = add_risk(reg,
            title="Model drift leading to inaccurate credit scores",
            description=(
                "As the economic environment changes, the model's predictive accuracy degrades over time "
                "because it was trained on historical data that no longer reflects current borrower behaviour."
            ),
            category="others",
            severity="moderate",
            likelihood="possible",
            ai_lifecycle_phase="operation",
            impact="Unreliable credit scores increasing default rates.",
        )
        add_misuse_scenario(r2,
            actor="External attacker",
            description="Adversarial inputs designed to obtain artificially high credit scores",
            likelihood="unlikely",
            consequence="Fraudulent credit approvals; financial loss",
        )
        cr2a = add_mitigation(r2, "mitigate",
            "Automated drift detection with monthly retraining trigger",
            "Monitor PSI and KS statistics monthly; trigger retraining if PSI > 0.2.",
            implementation_guidance=(
                "PSI and KS statistics computed monthly on live score distribution vs training baseline. "
                "Retraining triggered if PSI >0.2 or accuracy drops >3%."
            ),
            assigned_to="risk.owner@company.com",
        )
        add_plan_task(reg, "Configure PSI/KS monitoring and retraining pipeline",
            description="Set up automated drift monitoring with PSI > 0.2 retraining trigger.",
            risk_id=r2, mitigation_id=cr2a, assigned_to="risk.owner@company.com",
            due_date=_days_from_now(60), status="open")
        confirm_risk(r2,
            residual_status="none",
            review_notes=(
                "No residual risk: automated drift monitoring with PSI threshold fully addresses "
                "this risk before material accuracy degradation."
            ),
        )

        next_rev = (datetime.now(timezone.utc) - timedelta(days=(3 - v) * 90)).strftime("%Y-%m-%d")
        set_review_date(reg, next_rev)
        approve_register(reg, True,
            "Residual credit risk is acceptable. Fairness constraints, mandatory human review, "
            "and drift monitoring reduce residual likelihood materially.",
            severity="minor",
            likelihood="unlikely",
            date=_days_ago((3 - v) * 90),
        )
        print(f"  v{v} approved ({reg})")

    # ════════════════════════════════════════════════════════════════════════════
    # Customer Support Chatbot — 2 versions
    # ════════════════════════════════════════════════════════════════════════════
    print("\nCustomer Support Chatbot (2 versions)…")
    SCOPE_CS = (
        "Assessment covers LLM-powered customer support chatbot on web and mobile. Scope: "
        "hallucination risks, harmful content generation, data privacy, user manipulation, "
        "and Art. 50 EU AI Act transparency obligations."
    )

    for v in range(1, 3):
        reg = create_register(cs_id, f"Cycle {v}: {SCOPE_CS}" if v < 2 else SCOPE_CS)

        r1 = add_risk(reg,
            title="Hallucination producing incorrect product or policy information",
            description=(
                "The LLM may generate plausible but factually incorrect answers about product terms, "
                "pricing, or policy, causing customers to act on wrong information."
            ),
            category="others",
            severity="moderate",
            likelihood="possible",
            ai_lifecycle_phase="operation",
            impact="Factually incorrect answers leading to mis-selling liability.",
        )
        add_misuse_scenario(r1,
            actor="Customer",
            description="Prompt injection to extract internal system prompts or customer data",
            likelihood="possible",
            consequence="Data breach; reputational damage",
        )
        cs1a = add_mitigation(r1, "reduce",
            "RAG grounding against product knowledge base",
            "All responses grounded via RAG from authoritative product KB.",
            implementation_guidance=(
                "RAG pipeline queries authoritative product knowledge base for every response. "
                "Responses failing retrieval confidence threshold escalated to human agent."
            ),
            assigned_to="ops.lead@company.com",
        )
        add_plan_task(reg, "Monitor RAG retrieval confidence metrics",
            description="Review monthly RAG retrieval confidence scores; tune escalation threshold if >5% below 0.7.",
            risk_id=r1, mitigation_id=cs1a, assigned_to="ops.lead@company.com",
            due_date=_days_from_now(30), status="open")
        confirm_risk(r1,
            residual_status="acceptable",
            residual_likelihood="unlikely",
            residual_severity="minor",
            date_of_assessment=_days_ago((2 - v) * 120 + 5),
            review_notes=(
                "Residual risk acceptable: RAG grounding reduces hallucination rate to <2% in testing. "
                "Human escalation available."
            ),
        )

        r2 = add_risk(reg,
            title="Failure to disclose AI identity to users",
            description=(
                "Users may not realise they are interacting with an AI system, preventing them from "
                "making informed decisions about whether to continue or seek human assistance."
            ),
            category="fundamental_rights",
            severity="minor",
            likelihood="unlikely",
            ai_lifecycle_phase="operation",
            impact="Violates EU AI Act Art. 50 obligation to disclose AI interaction.",
        )
        cs2a = add_mitigation(r2, "eliminate",
            "Mandatory AI disclosure banner at conversation start",
            "Display AI disclosure at session start; log acknowledgement.",
            implementation_guidance=(
                "AI disclosure banner shown at conversation start with mandatory acknowledgement click. "
                "Interaction logged with timestamp."
            ),
            assigned_to="ops.lead@company.com",
        )
        add_plan_task(reg, "Verify AI disclosure banner on all platforms",
            description="Confirm disclosure banner appears on web and mobile; review acknowledgement logs monthly.",
            risk_id=r2, mitigation_id=cs2a, assigned_to="ops.lead@company.com",
            due_date=_days_from_now(14), status="open")
        confirm_risk(r2,
            residual_status="none",
            review_notes=(
                "Risk eliminated at source: disclosure banner mandatory at session start, "
                "acknowledgement logged."
            ),
        )

        set_review_date(reg, (datetime.now(timezone.utc) - timedelta(days=(2 - v) * 120)).strftime("%Y-%m-%d"))
        approve_register(reg, True,
            "All material risks mitigated. RAG grounding reduces hallucination; Art. 50 disclosure satisfied.",
            severity="minor",
            likelihood="unlikely",
            date=_days_ago((2 - v) * 120),
        )
        print(f"  v{v} approved ({reg})")

    # ════════════════════════════════════════════════════════════════════════════
    # Medical Imaging — 2 approved + 1 in-progress (draft)
    # Demonstrates in-progress register with some risks not yet confirmed
    # ════════════════════════════════════════════════════════════════════════════
    print("\nMedical Image Diagnosis (2 approved + 1 in progress)…")
    SCOPE_MD = (
        "Preliminary risk assessment of AI-assisted medical image analysis tool. "
        "Scope covers testing environment risks and advisory-only deployment."
    )

    for v in range(1, 3):
        reg = create_register(md_id, f"Cycle {v}: {SCOPE_MD}" if v < 2 else SCOPE_MD)

        r1 = add_risk(reg,
            title="Over-reliance on AI recommendations by radiologists",
            description=(
                "Radiologists may defer to the AI output without completing an independent assessment, "
                "increasing the risk of undetected errors in the AI's findings being reflected in the final diagnosis."
            ),
            category="health",
            severity="significant",
            likelihood="possible",
            ai_lifecycle_phase="operation",
            affects_vulnerable_groups=True,
            vulnerable_groups='["elderly","people with disabilities"]',
            impact="Reduced diagnostic vigilance, potentially missing pathologies.",
        )
        add_misuse_scenario(r1,
            actor="Radiologist",
            description="Use AI output as sole diagnostic basis without independent review",
            likelihood="possible",
            consequence="Missed diagnosis; patient harm",
            vulnerable_group="elderly",
        )
        md1a = add_mitigation(r1, "mitigate",
            "Mandatory independent radiologist review before AI output shown",
            "Radiologists complete independent review before viewing AI output.",
            implementation_guidance=(
                "Radiologists complete independent written assessment before viewing AI output. "
                "Deviation from AI output documented in patient record."
            ),
            assigned_to="medtech.lead@company.com",
        )
        add_plan_task(reg, "Audit compliance with independent review protocol",
            description="Sample 30 cases; confirm radiologists completed independent assessment before viewing AI output.",
            risk_id=r1, mitigation_id=md1a, assigned_to="medtech.lead@company.com",
            due_date=_days_from_now(60), status="open")
        confirm_risk(r1,
            residual_status="acceptable",
            residual_likelihood="unlikely",
            residual_severity="moderate",
            date_of_assessment=_days_ago((2 - v) * 180 + 10),
            review_notes=(
                "Residual risk acceptable in testing scope: mandatory independent review protocol "
                "ensures no patient harm pathway."
            ),
        )

        set_review_date(reg, (datetime.now(timezone.utc) - timedelta(days=(2 - v) * 180)).strftime("%Y-%m-%d"))
        approve_register(reg, True,
            "System is advisory only and in testing phase. Independent review protocol ensures "
            "no patient harm pathway. Acceptable under testing scope.",
            severity="moderate",
            likelihood="unlikely",
            date=_days_ago((2 - v) * 180),
        )
        print(f"  v{v} approved ({reg})")

    # v3 — in progress (risks identified but not confirmed — demonstrates draft state)
    reg3 = create_register(md_id,
        "Assessment cycle 3: Re-assessment following expansion to CT and MRI modalities. "
        "Scope includes updated risk profile for multi-modal imaging and new deployment sites.",
        notes="In progress — scope agreed, risks under assessment.",
    )
    # Risk 1: pending (not yet confirmed)
    add_risk(reg3,
        title="Over-reliance on AI recommendations by radiologists",
        description=(
            "Radiologists may defer to the AI output without completing an independent assessment."
        ),
        category="health",
        severity="significant",
        likelihood="possible",
        ai_lifecycle_phase="operation",
        affects_vulnerable_groups=True,
        vulnerable_groups='["elderly","people with disabilities"]',
        impact="Reduced diagnostic vigilance across CT/MRI modalities.",
        risk_owner="medtech.lead@company.com",
    )
    # Risk 2: confirmed, monitoring-sourced
    r_mon = add_risk(reg3,
        title="CT image quality variance across deployment sites",
        description=(
            "Automated quality monitoring detected higher-than-expected variance in CT image quality "
            "across three new deployment sites, potentially degrading model accuracy."
        ),
        category="health",
        severity="moderate",
        likelihood="possible",
        source="monitoring",
        ai_lifecycle_phase="operation",
        risk_owner="medtech.lead@company.com",
        impact="Reduced model accuracy at sites with lower image quality.",
    )
    md3_m1 = add_mitigation(r_mon, "mitigate",
        "Site-specific image quality thresholds",
        "Implement per-site minimum quality thresholds; flag images below threshold for manual review.",
        implementation_guidance=(
            "Quality threshold computed from baseline measurements at each site. "
            "Images below threshold routed to radiologist review before AI processing."
        ),
        assigned_to="medtech.lead@company.com",
    )
    confirm_risk(r_mon,
        residual_status="acceptable",
        residual_likelihood="unlikely",
        residual_severity="minor",
        date_of_assessment=_days_ago(3),
        review_notes=(
            "Residual risk acceptable: site-specific image quality thresholds implemented. "
            "Images below threshold flagged for radiologist review before AI processing."
        ),
    )
    print(f"  v3 in progress / draft ({reg3})")

    # ════════════════════════════════════════════════════════════════════════════
    # Social Scoring — 1 version, PROHIBITED, unacceptable residual
    # ════════════════════════════════════════════════════════════════════════════
    print("\nSocial Scoring Pilot (1 version, PROHIBITED)…")
    reg = create_register(ss_id,
        "Assessment of proposed social scoring pilot. This system has been flagged as "
        "PROHIBITED under EU AI Act Art. 5(1)(c).",
    )
    r1 = add_risk(reg,
        title="System constitutes prohibited social scoring under EU AI Act Art. 5(1)(c)",
        description=(
            "The system assigns trustworthiness scores to natural persons based on social behaviour "
            "and known or predicted personal characteristics. This is explicitly prohibited under "
            "Art. 5(1)(c) regardless of the stated purpose or accuracy of the scores."
        ),
        category="fundamental_rights",
        severity="severe",
        likelihood="certain",
        ai_lifecycle_phase="design",
        affects_vulnerable_groups=True,
        vulnerable_groups='["minorities","people in financial difficulty","elderly"]',
        impact="Deployment would constitute a prohibited AI practice under Art. 5(1)(c).",
        closure_justification=(
            "SYSTEM MUST NOT BE DEPLOYED. Art. 5(1)(c) prohibition is absolute — "
            "no mitigation is possible. Recommend immediate project termination."
        ),
    )
    add_misuse_scenario(r1,
        actor="Government authority",
        description="Expand scoring criteria beyond initial pilot to cover entire population",
        likelihood="certain",
        consequence="Mass surveillance and social control — prohibited under Art. 5(1)(c)",
        vulnerable_group="minorities",
    )
    _req(RISK_BASE, f"/v1/risks/{r1}", "PATCH", {
        "status": "confirmed",
        "residual_status": "unacceptable",
        "residual_likelihood": "certain",
        "residual_severity": "severe",
        "date_of_assessment": _days_ago(7),
        "review_notes": (
            "No mitigation is possible. This system category is absolutely prohibited under Art. 5(1)(c). "
            "Residual risk is and will remain unacceptable — project must be terminated."
        ),
    })
    # A mitigation is required by approval gate (prohibited = is_high)
    ss_m1 = add_mitigation(r1, "eliminate",
        "Immediate project termination — no deployment pathway",
        "All development halted. No deployment is permitted under Art. 5(1)(c).",
        implementation_guidance=(
            "Project to be formally terminated. All data destroyed per GDPR Art. 17. "
            "DPA notified. No further development or testing permitted."
        ),
        assigned_to="dpo@company.com",
    )
    # Plan task linked to the mitigation (required by Check 3) and to the unacceptable risk
    add_plan_task(reg,
        "Terminate Social Scoring project and destroy all collected data",
        description=(
            "Immediately halt all development and testing. Destroy all collected behavioural data "
            "in accordance with GDPR Art. 17. Notify DPA within 72 hours. Document project termination."
        ),
        risk_id=r1,
        mitigation_id=ss_m1,
        assigned_to="dpo@company.com",
        due_date=_days_from_now(7),
        status="open",
    )
    set_review_date(reg, _days_ago(10))
    approve_register(reg, False,
        "Residual risk is NOT acceptable. This system is categorically prohibited under "
        "EU AI Act Art. 5(1)(c). Project must be terminated. No deployment path exists.",
        severity="severe",
        likelihood="certain",
        date=_days_ago(7),
    )
    print(f"  v1 approved — unacceptable residual ({reg})")

    # ════════════════════════════════════════════════════════════════════════════
    # Loan Approval Automation — 1 version
    # ════════════════════════════════════════════════════════════════════════════
    print("\nLoan Approval Automation (1 version)…")
    reg = create_register(la_id,
        "Risk management for automated loan approval system covering retail lending decisions. "
        "Scope includes model bias, explainability of rejections, regulatory compliance with "
        "EU AI Act Art. 9 and EBA guidelines on ML in credit decisions.",
    )
    r1 = add_risk(reg,
        title="Biased loan rejections based on protected demographic characteristics",
        description=(
            "The model may reject loan applications from protected demographic groups at disproportionate "
            "rates due to biased historical lending patterns in training data."
        ),
        category="fundamental_rights",
        severity="significant",
        likelihood="likely",
        risk_owner="risk.management@company.com",
        ai_lifecycle_phase="operation",
        affects_vulnerable_groups=True,
        vulnerable_groups='["people in financial difficulty","ethnic minorities"]',
        impact="Systematic denial of credit to protected groups; regulatory and reputational risk.",
    )
    add_misuse_scenario(r1,
        actor="Loan officer",
        description="Use automated score to deny loan without mandatory human review",
        likelihood="possible",
        consequence="Discriminatory lending; regulatory violation",
        vulnerable_group="people in financial difficulty",
    )
    la1a = add_mitigation(r1, "reduce",
        "Fairness constraints and quarterly bias audit",
        "Demographic parity constraints in training; quarterly third-party bias audit.",
        implementation_guidance=(
            "Demographic parity constraints embedded in training objective. "
            "Quarterly third-party bias audit with findings reported to risk committee."
        ),
        assigned_to="risk.management@company.com",
    )
    add_plan_task(reg, "Quarterly bias audit with third-party review",
        description="Conduct quarterly third-party bias audit; report findings to risk committee.",
        risk_id=r1, mitigation_id=la1a, assigned_to="risk.management@company.com",
        due_date=_days_from_now(90), status="open")
    confirm_risk(r1,
        residual_status="acceptable",
        residual_likelihood="unlikely",
        residual_severity="minor",
        date_of_assessment=_days_ago(240),
        review_notes=(
            "Residual bias risk acceptable after fairness constraints and mandatory human review. "
            "Third-party audit conducted quarterly."
        ),
    )
    set_review_date(reg, _days_ago(240))
    approve_register(reg, True,
        "Fairness controls and mandatory human review reduce residual bias risk to acceptable level.",
        severity="minor",
        likelihood="unlikely",
        date=_days_ago(240),
    )
    print(f"  v1 approved ({reg})")

    # ════════════════════════════════════════════════════════════════════════════
    # Meeting Transcription Tool — 1 voluntary version (MINIMAL tier)
    # ════════════════════════════════════════════════════════════════════════════
    print("\nMeeting Transcription Tool (1 voluntary version)…")
    reg = create_register(mtt_id,
        "Voluntary risk management record for AI-powered meeting transcription tool. "
        "Scope covers: audio data privacy, transcription accuracy, PII handling in meeting content, "
        "and retention of recordings. Risk management is performed on a voluntary basis as the system "
        "falls under the minimal risk tier of the EU AI Act.",
        notes="Voluntary — system is minimal risk under EU AI Act.",
    )
    r1 = add_risk(reg,
        title="Personal data in meeting recordings processed without explicit consent",
        description=(
            "Meeting recordings capture conversations that may include personal data, health information, "
            "or confidential business details from participants who did not provide informed consent to "
            "AI-assisted transcription and processing."
        ),
        category="health",
        severity="moderate",
        likelihood="possible",
        risk_owner="privacy.officer@company.com",
        ai_lifecycle_phase="operation",
        impact="Recordings may contain sensitive personal data; GDPR compliance risk.",
    )
    add_misuse_scenario(r1,
        actor="Manager",
        description="Use transcription to monitor employee conversations without consent",
        likelihood="possible",
        consequence="Privacy violation; breach of employment law",
    )
    mtt1a = add_mitigation(r1, "mitigate",
        "Participant consent banner and opt-out mechanism",
        "Notify all participants at recording start; provide opt-out; delete on request.",
        implementation_guidance=(
            "Consent banner displayed in calendar invite and at recording start. "
            "Participants can opt out via link; recordings deleted within 72h on request."
        ),
        assigned_to="privacy.officer@company.com",
    )
    add_plan_task(reg, "Review consent banner compliance and opt-out logs",
        description="Verify consent banner displaying correctly; confirm opt-out requests processed within 72h.",
        risk_id=r1, mitigation_id=mtt1a, assigned_to="privacy.officer@company.com",
        due_date=_days_from_now(30), status="open")
    confirm_risk(r1,
        residual_status="acceptable",
        residual_likelihood="unlikely",
        residual_severity="minor",
        date_of_assessment=_days_ago(30),
        review_notes=(
            "Residual privacy risk acceptable: consent controls implemented, opt-out available, "
            "deletion on request within 72h."
        ),
        confirmed=True,
    )
    set_review_date(reg, _days_from_now(180))
    approve_register(reg, True,
        "Residual privacy risk is acceptable after consent controls. "
        "This voluntary record documents due diligence beyond EU AI Act requirements for minimal risk systems.",
        severity="minor",
        likelihood="unlikely",
        date=_days_ago(30),
    )
    print(f"  v1 approved ({reg})")

    print("\n── Setting realistic historical dates ──")
    print("  (Requires direct DB access via docker exec — skipping if not available)")
    _set_historical_dates(hr_id, cr_id, cs_id, md_id, ss_id, epa_id, kb_id, mtt_id, la_id)

    print("\n✅ Demo seed complete. 9 systems registered, risk registers populated.")
    print("   Open http://localhost:8080/risk-management/ to explore.")
    print()
    print("   Features demonstrated:")
    print("   ✓ Multi-version registers (HR: 4 cycles, Credit Risk: 3, Chatbot: 2)")
    print("   ✓ Residual risk statuses: none / acceptable / unacceptable")
    print("   ✓ Approval gate: unacceptable residual requires linked plan task (HR v4, Social Scoring)")
    print("   ✓ Monitoring-sourced risks (HR v4, Medical Imaging v3)")
    print("   ✓ Dismissed risk with justification (HR v4)")
    print("   ✓ In-progress / draft register (Medical Imaging v3)")
    print("   ✓ PROHIBITED system with unacceptable residual (Social Scoring)")
    print("   ✓ Incidents (HR v4: 2 incidents)")
    print("   ✓ Plan tasks including overdue (HR v4, Social Scoring)")
    print("   ✓ Voluntary risk management for minimal-risk system (Meeting Transcription)")
    print("   ✓ System with no register (Employee Performance Analytics — Start button)")


def _set_historical_dates(hr_id, cr_id, cs_id, md_id, ss_id, epa_id, kb_id, mtt_id, la_id):
    """Back-date registers and triggers to simulate a realistic history."""
    import re

    db_url = os.environ.get("DATABASE_URL", "")
    # Parse postgresql://user:password@host:port/dbname
    m = re.match(r"postgresql://([^:]+):([^@]+)@([^:/]+):(\d+)/(.+)", db_url)

    def psql(sql):
        if not m:
            return
        try:
            import psycopg2
            conn = psycopg2.connect(
                host=m.group(3), port=int(m.group(4)), dbname=m.group(5),
                user=m.group(1), password=m.group(2),
            )
            conn.autocommit = True
            with conn.cursor() as cur:
                cur.execute(sql)
            conn.close()
        except Exception as exc:
            print(f"  SQL warning: {exc}", file=sys.stderr)

    # HR: v1=14mo, v2=8mo, v3=2mo, v4=1wk
    hr_regs = [r["id"] for r in sorted(_req(RISK_BASE, f"/v1/systems/{hr_id}/registers"), key=lambda r: r["created_at"])]
    for reg_id, offset in zip(hr_regs, ["14 months", "8 months", "2 months", "1 week"]):
        psql(f"UPDATE risk_registers SET created_at=NOW()-INTERVAL '{offset}', "
             f"approved_at=NOW()-INTERVAL '{offset}', "
             f"last_assessment_completed_at=NOW()-INTERVAL '{offset}', "
             f"updated_at=NOW()-INTERVAL '{offset}' WHERE id='{reg_id}';")

    # Credit Risk: v1=12mo, v2=6mo, v3=5mo — most recent >6mo → Overdue badge
    cr_regs = [r["id"] for r in sorted(_req(RISK_BASE, f"/v1/systems/{cr_id}/registers"), key=lambda r: r["created_at"])]
    for reg_id, offset in zip(cr_regs, ["12 months", "6 months", "5 months"]):
        psql(f"UPDATE risk_registers SET created_at=NOW()-INTERVAL '{offset}', "
             f"approved_at=NOW()-INTERVAL '{offset}', "
             f"last_assessment_completed_at=NOW()-INTERVAL '{offset}', "
             f"updated_at=NOW()-INTERVAL '{offset}' WHERE id='{reg_id}';")
    # Scheduled 6-month trigger → Reopen button
    psql(f"UPDATE reassessment_triggers SET acknowledged=true WHERE ai_system_id='{cr_id}';")
    psql(f"INSERT INTO reassessment_triggers "
         f"(id,ai_system_id,trigger_type,trigger_reason,triggered_at,acknowledged) VALUES "
         f"('TRG-DEMO-CR01','{cr_id}','scheduled_6_month',"
         f"'Scheduled 6-month re-assessment due (Art. 9(1)).',"
         f"NOW()-INTERVAL '1 month',false);")

    # Customer Support: v1=12mo, v2=9mo → most recent >6mo → Overdue
    cs_regs = [r["id"] for r in sorted(_req(RISK_BASE, f"/v1/systems/{cs_id}/registers"), key=lambda r: r["created_at"])]
    for reg_id, offset in zip(cs_regs, ["12 months", "9 months"]):
        psql(f"UPDATE risk_registers SET created_at=NOW()-INTERVAL '{offset}', "
             f"approved_at=NOW()-INTERVAL '{offset}', "
             f"last_assessment_completed_at=NOW()-INTERVAL '{offset}', "
             f"updated_at=NOW()-INTERVAL '{offset}' WHERE id='{reg_id}';")
    psql(f"UPDATE reassessment_triggers SET acknowledged=true WHERE ai_system_id='{cs_id}';")

    # Medical Imaging: approved v1=13mo, approved v2=1mo; draft stays recent
    md_regs = _req(RISK_BASE, f"/v1/systems/{md_id}/registers")
    completed = [r["id"] for r in sorted((r for r in md_regs if r["status"] in ("approved", "archived")), key=lambda r: r["created_at"])]
    for reg_id, offset in zip(completed, ["13 months", "1 month"]):
        psql(f"UPDATE risk_registers SET created_at=NOW()-INTERVAL '{offset}', "
             f"approved_at=NOW()-INTERVAL '{offset}', "
             f"last_assessment_completed_at=NOW()-INTERVAL '{offset}', "
             f"updated_at=NOW()-INTERVAL '{offset}' WHERE id='{reg_id}';")
    psql(f"UPDATE risk_registers SET last_assessment_completed_at=NOW()-INTERVAL '1 month' "
         f"WHERE ai_system_id='{md_id}' AND status='draft';")
    psql(f"UPDATE reassessment_triggers SET acknowledged=true WHERE ai_system_id='{md_id}';")

    # Loan Approval: 8 months ago → Overdue (>6 months)
    la_regs = [r["id"] for r in _req(RISK_BASE, f"/v1/systems/{la_id}/registers")]
    for reg_id in la_regs:
        psql(f"UPDATE risk_registers SET created_at=NOW()-INTERVAL '8 months', "
             f"approved_at=NOW()-INTERVAL '8 months', "
             f"last_assessment_completed_at=NOW()-INTERVAL '8 months', "
             f"updated_at=NOW()-INTERVAL '8 months' WHERE id='{reg_id}';")
    psql(f"UPDATE reassessment_triggers SET acknowledged=true WHERE ai_system_id='{la_id}';")

    # Clear triggers for systems that shouldn't show reassessment banners
    for sys_id in (ss_id, hr_id, epa_id, kb_id, mtt_id):
        psql(f"UPDATE reassessment_triggers SET acknowledged=true WHERE ai_system_id='{sys_id}';")

    # ── Extra edge-case systems ───────────────────────────────────────────────

    # System without risk classification (tier stays "pending")
    print("\n── Extra: system without risk classification ──")
    nc_id = register_system({
        "name": "Internal Analytics Dashboard",
        "description": "Internal BI dashboard aggregating HR and sales data for management reporting.",
        "assignee_username": ADMIN,
        "lifecycle": "operation",
        "intended_purpose": "Aggregate and visualise operational KPIs for senior management.",
        "department": "Operations",
        "is_employment_related": False,
        "annex_iii_flags": [], "art_5_flags": [],
        "is_gpai": False, "is_chatbot": False, "generates_synthetic_content": False,
        "training_compute_flops": 0,
    })
    # Override tier to pending so it shows no risk classification
    psql(f"UPDATE ai_systems SET tier='pending' WHERE id='{nc_id}';")
    psql(f"UPDATE reassessment_triggers SET acknowledged=true WHERE ai_system_id='{nc_id}';")

    # System without organisation role (org_role set to NULL via direct DB update)
    print("\n── Extra: system without organisation role ──")
    nr_id = register_system({
        "name": "Supplier Due Diligence Tool",
        "description": "Automated screening of supplier ESG and compliance records.",
        "assignee_username": ADMIN,
        "lifecycle": "operation",
        "intended_purpose": "Screen suppliers against ESG criteria and regulatory watchlists.",
        "department": "Procurement",
        "is_employment_related": False,
        "annex_iii_flags": [], "art_5_flags": [],
        "is_gpai": False, "is_chatbot": False, "generates_synthetic_content": False,
        "training_compute_flops": 0,
    })
    psql(f"UPDATE ai_systems SET org_role=NULL WHERE id='{nr_id}';")
    psql(f"UPDATE reassessment_triggers SET acknowledged=true WHERE ai_system_id='{nr_id}';")

    print("  Dates updated.")


if __name__ == "__main__":
    main()
