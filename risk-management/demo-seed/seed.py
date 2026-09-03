"""
Risk Management demo seed.

Creates 5 diverse AI systems in the registry and fully populates their risk
registers (risks, mitigations, residual risk, approval) so the module is
ready to demonstrate on a fresh install.

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
            # 409 Conflict on duplicate — treat as success
            if e.code == 409:
                return {}
            print(f"  HTTP {e.code} {method} {url}: {err}", file=sys.stderr)
            raise
        except Exception as e:
            if attempt < retries - 1:
                print(f"  Retrying {url} ({e})…", file=sys.stderr)
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


def reclassify(sys_id, flags: dict):
    _req(REGISTRY_BASE, f"/v1/systems/{sys_id}", "PUT",
         {**_req(REGISTRY_BASE, f"/v1/systems/{sys_id}"), **flags,
          **{k: None for k in ("id","tier","basis","annex_iii_area","classification_rationale",
                               "created_at","updated_at","field_confirmations")}})


def create_register(sys_id, scope, notes="") -> str:
    reg = _req(RISK_BASE, f"/v1/systems/{sys_id}/registers", "POST",
               {"assessment_scope": scope, "notes": notes})
    return reg["id"]


def add_risk(reg_id, **fields) -> str:
    r = _req(RISK_BASE, f"/v1/registers/{reg_id}/risks", "POST", fields)
    return r["id"]


def confirm_risk(risk_id, residual_likelihood="unlikely", residual_severity="low", review_notes=""):
    _req(RISK_BASE, f"/v1/risks/{risk_id}", "PATCH", {
        "status": "confirmed",
        "residual_likelihood": residual_likelihood,
        "residual_severity": residual_severity,
        "final_risk_level": "low",
        "review_notes": review_notes,
    })


def add_mitigation(risk_id, hierarchy_level, title, description="", implementation_guidance="", assigned_to=None, due_date=None):
    _req(RISK_BASE, f"/v1/risks/{risk_id}/mitigations", "POST", {
        "title": title, "description": description,
        "hierarchy_level": hierarchy_level,
        "implementation_guidance": implementation_guidance,
        "status": "planned",
        "assigned_to": assigned_to,
        "due_date": due_date,
        "override_notes": "",
    })


def approve_register(reg_id, acceptable, argument):
    _req(RISK_BASE, f"/v1/registers/{reg_id}/approve", "POST", {
        "residual_risk_acceptable": acceptable,
        "residual_risk_argument": argument,
    })


def set_dates_sql(commands: list[str]):
    """Run raw SQL via psql inside the postgres container via docker exec."""
    sql = " ".join(commands)
    os.system(f'docker exec ai-trust-git-postgres-1 psql -U postgres -d ai_trust -c "{sql}" 2>/dev/null')


def main():
    wait_for_services()

    print("\n── Registering AI systems ──")

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
    # Reclassify with correct flag name
    sys_hr = _req(REGISTRY_BASE, f"/v1/systems/{hr_id}")
    sys_hr.update({"is_employment_related": True})
    for k in ("id","tier","basis","annex_iii_area","classification_rationale","created_at","updated_at","field_confirmations"):
        sys_hr.pop(k, None)
    _req(REGISTRY_BASE, f"/v1/systems/{hr_id}", "PUT", sys_hr)

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
    sys_cr = _req(REGISTRY_BASE, f"/v1/systems/{cr_id}")
    sys_cr.update({"is_credit_scoring": True})
    for k in ("id","tier","basis","annex_iii_area","classification_rationale","created_at","updated_at","field_confirmations"):
        sys_cr.pop(k, None)
    _req(REGISTRY_BASE, f"/v1/systems/{cr_id}", "PUT", sys_cr)

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
    sys_ss = _req(REGISTRY_BASE, f"/v1/systems/{ss_id}")
    sys_ss.update({"social_scoring_public": True})
    for k in ("id","tier","basis","annex_iii_area","classification_rationale","created_at","updated_at","field_confirmations"):
        sys_ss.pop(k, None)
    _req(REGISTRY_BASE, f"/v1/systems/{ss_id}", "PUT", sys_ss)

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
    # No risk register created — demonstrates green "Start" button

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
    sys_la = _req(REGISTRY_BASE, f"/v1/systems/{la_id}")
    sys_la.update({"is_credit_scoring": True})
    for k in ("id","tier","basis","annex_iii_area","classification_rationale","created_at","updated_at","field_confirmations"):
        sys_la.pop(k, None)
    _req(REGISTRY_BASE, f"/v1/systems/{la_id}", "PUT", sys_la)

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
    # No risk register — demonstrates green "Risk management optional" badge

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
    # Voluntary risk register created below — demonstrates "Voluntary — risk management optional" badge

    print("\n── Creating risk registers ──")

    # ── HR Screening — 4 versions ─────────────────────────────────────────────
    print("\nHR Screening (4 versions)…")
    SCOPE_HR = ("Assessment covers automated CV screening and candidate ranking for HR recruitment "
                "across all business units. Scope includes: training data bias, impact on protected "
                "characteristics (age, gender, ethnicity), transparency of scoring, human oversight, "
                "and Art. 9/10 EU AI Act compliance.")
    ARG_HR = ("Residual risk is acceptable after implementation of bias audit and explainability "
              "controls. Monthly monitoring ensures ongoing compliance.")

    for v in range(1, 5):
        scope = SCOPE_HR if v == 4 else f"Assessment cycle {v}: {SCOPE_HR}"
        reg = create_register(hr_id, scope)
        r1 = add_risk(reg, title="Discriminatory screening based on protected characteristics",
                      category="bias", severity="high", likelihood="likely", risk_type="foreseeable",
                      risk_owner="hr.director@company.com",
                      ai_lifecycle_phase="operation",
                      affects_vulnerable_groups=True,
                      vulnerable_groups='["women","ethnic minorities","older workers"]',
                      impact="Systematic exclusion of candidates based on gender, age or ethnicity.",
                      misuse_scenarios=[{"actor": "Recruiter", "description": "Manually override AI score for candidates from specific demographic groups", "likelihood": "possible", "consequence": "Amplifies rather than reduces discriminatory outcomes", "vulnerable_group": "ethnic minorities"}])
        confirm_risk(r1, "unlikely", "low",
                     review_notes="Residual risk acceptable: protected attributes excluded from inputs and monthly parity audits in place. Likelihood reduced from Likely to Unlikely.")
        add_mitigation(r1, "eliminate", "Exclude protected attributes from model inputs",
                       "Remove name, gender, age, address from all training data and inference inputs.",
                       implementation_guidance="Remove name, gender, age, postcode, and any proxy attributes (school name, address) from training data pipeline and inference inputs. Validated by data audit.",
                       assigned_to="hr.director@company.com")
        add_mitigation(r1, "mitigate", "Monthly bias audit with demographic parity testing",
                       "Run monthly fairness checks; reject model versions failing >5% parity gap.",
                       implementation_guidance="Monthly fairness report comparing acceptance rates across gender, age band, ethnicity. Model version rejected if demographic parity gap >5%.",
                       assigned_to="hr.director@company.com")
        r2 = add_risk(reg, title="Lack of explainability for rejected candidates",
                      category="legal", severity="medium", likelihood="likely", risk_type="known",
                      ai_lifecycle_phase="operation",
                      impact="Candidates denied without explanation, violating GDPR Art. 22.",
                      misuse_scenarios=[{"actor": "Candidate", "description": "Deliberately omit personal details to game the scoring algorithm", "likelihood": "possible", "consequence": "Circumvents intended screening, unfair advantage", "vulnerable_group": None}])
        confirm_risk(r2, "unlikely", "low",
                     review_notes="Residual risk acceptable: SHAP explanations satisfy GDPR Art. 22 requirement. All rejections include per-decision report.")
        add_mitigation(r2, "mitigate", "SHAP-based per-decision explanation report",
                       "Generate SHAP feature importance report for every rejection; store 3 years.",
                       implementation_guidance="SHAP feature importance computed per inference call. Report stored in candidate record for 3 years. Accessible to candidates on request.",
                       assigned_to="hr.director@company.com")
        approve_register(reg, True, ARG_HR)
        print(f"  v{v} approved ({reg})")

    # ── Credit Risk — 3 versions ──────────────────────────────────────────────
    print("\nCredit Risk (3 versions)…")
    SCOPE_CR = ("Assessment covers automated creditworthiness scoring for retail lending: training "
                "data quality and representativeness, demographic bias risks, model accuracy and "
                "misclassification rates, impact on customers denied credit, human oversight of "
                "rejection decisions, and compliance with EU AI Act Art. 9 and Art. 10 obligations.")
    ARG_CR = ("Residual credit risk is acceptable. Fairness constraints, mandatory human review, "
              "and drift monitoring reduce residual likelihood materially.")

    for v in range(1, 4):
        reg = create_register(cr_id, f"Cycle {v}: {SCOPE_CR}" if v < 3 else SCOPE_CR)
        r1 = add_risk(reg, title="Demographic bias in credit scoring leading to discriminatory decisions",
                      category="bias", severity="high", likelihood="likely", risk_type="foreseeable",
                      risk_owner="risk.owner@company.com",
                      ai_lifecycle_phase="operation",
                      affects_vulnerable_groups=True,
                      vulnerable_groups='["people in financial difficulty","ethnic minorities"]',
                      impact="Customers from protected groups systematically denied credit.",
                      misuse_scenarios=[{"actor": "Loan officer", "description": "Use AI score to justify pre-determined rejection without review", "likelihood": "unlikely", "consequence": "Human oversight bypassed; discriminatory lending", "vulnerable_group": "people in financial difficulty"}])
        confirm_risk(r1, "unlikely", "medium",
                     review_notes="Residual risk acceptable with mandatory human review for all rejections and quarterly bias audit. Demographic parity constraints limit model-level bias.")
        add_mitigation(r1, "reduce", "Fairness constraints in model training",
                       "Apply demographic parity constraints; retrain quarterly.",
                       implementation_guidance="Demographic parity constraint applied during model training via reweighting. Retrained quarterly with updated data.",
                       assigned_to="risk.owner@company.com")
        add_mitigation(r1, "mitigate", "Human review mandatory for all rejections",
                       "All automated rejections require secondary human review.",
                       implementation_guidance="Automated rejection flagged for secondary human review within 24h. Reviewer documents decision rationale.",
                       assigned_to="risk.owner@company.com")
        r2 = add_risk(reg, title="Model drift leading to inaccurate credit scores",
                      category="performance", severity="medium", likelihood="possible", risk_type="known",
                      ai_lifecycle_phase="operation",
                      impact="Unreliable credit scores increasing default rates.",
                      misuse_scenarios=[{"actor": "External attacker", "description": "Adversarial inputs designed to obtain artificially high credit scores", "likelihood": "unlikely", "consequence": "Fraudulent credit approvals; financial loss", "vulnerable_group": None}])
        confirm_risk(r2, "rare", "low",
                     review_notes="Residual risk acceptable: automated drift monitoring with PSI threshold triggers retraining before material accuracy degradation.")
        add_mitigation(r2, "mitigate", "Automated drift detection with monthly retraining trigger",
                       "Monitor PSI and KS statistics monthly; trigger retraining if PSI > 0.2.",
                       implementation_guidance="PSI and KS statistics computed monthly on live score distribution vs training baseline. Retraining triggered if PSI >0.2 or accuracy drops >3%.",
                       assigned_to="risk.owner@company.com")
        approve_register(reg, True, ARG_CR)
        print(f"  v{v} approved ({reg})")

    # ── Customer Support Chatbot — 2 versions ─────────────────────────────────
    print("\nCustomer Support Chatbot (2 versions)…")
    SCOPE_CS = ("Assessment covers LLM-powered customer support chatbot on web and mobile. Scope: "
                "hallucination risks, harmful content generation, data privacy, user manipulation, "
                "and Art. 50 EU AI Act transparency obligations.")
    ARG_CS = "All material risks mitigated. RAG grounding reduces hallucination; Art. 50 disclosure satisfied."

    for v in range(1, 3):
        reg = create_register(cs_id, f"Cycle {v}: {SCOPE_CS}" if v < 2 else SCOPE_CS)
        r1 = add_risk(reg, title="Hallucination producing incorrect product or policy information",
                      category="performance", severity="medium", likelihood="possible", risk_type="foreseeable",
                      ai_lifecycle_phase="operation",
                      impact="Factually incorrect answers leading to mis-selling liability.",
                      misuse_scenarios=[{"actor": "Customer", "description": "Prompt injection to extract internal system prompts or customer data", "likelihood": "possible", "consequence": "Data breach; reputational damage", "vulnerable_group": None}])
        confirm_risk(r1, "unlikely", "low",
                     review_notes="Residual risk acceptable: RAG grounding reduces hallucination rate to <2% in testing. Human escalation available.")
        add_mitigation(r1, "reduce", "RAG grounding against product knowledge base",
                       "All responses grounded via RAG from authoritative product KB.",
                       implementation_guidance="RAG pipeline queries authoritative product knowledge base for every response. Responses failing retrieval confidence threshold escalated to human agent.",
                       assigned_to="ops.lead@company.com")
        r2 = add_risk(reg, title="Failure to disclose AI identity to users",
                      category="legal", severity="low", likelihood="rare", risk_type="known",
                      ai_lifecycle_phase="operation",
                      impact="Violates EU AI Act Art. 50 obligation to disclose AI interaction.")
        confirm_risk(r2, "rare", "low",
                     review_notes="Risk eliminated at source: disclosure banner mandatory at session start, acknowledgement logged.")
        add_mitigation(r2, "eliminate", "Mandatory AI disclosure banner at conversation start",
                       "Display AI disclosure at session start; log acknowledgement.",
                       implementation_guidance="AI disclosure banner shown at conversation start with mandatory acknowledgement click. Interaction logged with timestamp.",
                       assigned_to="ops.lead@company.com")
        approve_register(reg, True, ARG_CS)
        print(f"  v{v} approved ({reg})")

    # ── Medical Imaging — 2 approved + 1 in-progress ──────────────────────────
    print("\nMedical Image Diagnosis (2 approved + 1 in progress)…")
    SCOPE_MD = ("Preliminary risk assessment of AI-assisted medical image analysis tool. "
                "Scope covers testing environment risks and advisory-only deployment.")
    ARG_MD = ("System is advisory only and in testing phase. Independent review protocol "
              "ensures no patient harm pathway. Acceptable under testing scope.")

    for v in range(1, 3):
        reg = create_register(md_id, f"Cycle {v}: {SCOPE_MD}" if v < 2 else SCOPE_MD)
        r1 = add_risk(reg, title="Over-reliance on AI recommendations by radiologists",
                      category="safety", severity="high", likelihood="possible", risk_type="foreseeable",
                      ai_lifecycle_phase="operation",
                      affects_vulnerable_groups=True,
                      vulnerable_groups='["elderly","people with disabilities"]',
                      impact="Reduced diagnostic vigilance, potentially missing pathologies.",
                      misuse_scenarios=[{"actor": "Radiologist", "description": "Use AI output as sole diagnostic basis without independent review", "likelihood": "possible", "consequence": "Missed diagnosis; patient harm", "vulnerable_group": "elderly"}])
        confirm_risk(r1, "unlikely", "medium",
                     review_notes="Residual risk acceptable in testing scope: mandatory independent review protocol ensures no patient harm pathway.")
        add_mitigation(r1, "mitigate", "Mandatory independent radiologist review before AI output shown",
                       "Radiologists complete independent review before viewing AI output.",
                       implementation_guidance="Radiologists complete independent written assessment before viewing AI output. Deviation from AI output documented in patient record.",
                       assigned_to="medtech.lead@company.com")
        approve_register(reg, True, ARG_MD)
        print(f"  v{v} approved ({reg})")

    # v3 — in progress (draft, risks identified but not confirmed)
    reg3 = create_register(md_id,
        "Assessment cycle 3: Re-assessment following expansion to CT and MRI modalities. "
        "Scope includes updated risk profile for multi-modal imaging and new deployment sites.",
        notes="In progress — scope agreed, risks being identified.")
    add_risk(reg3, title="Over-reliance on AI recommendations by radiologists",
             category="safety", severity="high", likelihood="possible", risk_type="foreseeable",
             ai_lifecycle_phase="operation",
             affects_vulnerable_groups=True,
             vulnerable_groups='["elderly","people with disabilities"]',
             impact="Reduced diagnostic vigilance across CT/MRI modalities.",
             risk_owner="medtech.lead@company.com")
    add_risk(reg3, title="Training data bias towards specific scanner manufacturers",
             category="bias", severity="medium", likelihood="possible", risk_type="known",
             ai_lifecycle_phase="operation",
             impact="Reduced accuracy at new sites using different scanner hardware.",
             risk_owner="medtech.lead@company.com")
    print(f"  v3 in progress / draft ({reg3})")

    # ── Social Scoring — 1 version, PROHIBITED ────────────────────────────────
    print("\nSocial Scoring Pilot (1 version, PROHIBITED)…")
    reg = create_register(ss_id,
        "Assessment of proposed social scoring pilot. This system has been flagged as "
        "PROHIBITED under EU AI Act Art. 5(1)(c).")
    r1 = add_risk(reg, title="System constitutes prohibited social scoring under EU AI Act Art. 5(1)(c)",
                  category="legal", severity="critical", likelihood="certain", risk_type="known",
                  ai_lifecycle_phase="design",
                  affects_vulnerable_groups=True,
                  vulnerable_groups='["minorities","people in financial difficulty","elderly"]',
                  impact="Deployment would constitute a prohibited AI practice under Art. 5(1)(c).",
                  misuse_scenarios=[{"actor": "Government authority", "description": "Expand scoring criteria beyond initial pilot to cover entire population", "likelihood": "certain", "consequence": "Mass surveillance and social control — prohibited under Art. 5(1)(c)", "vulnerable_group": "minorities"}],
                  closure_justification=(
                      "SYSTEM MUST NOT BE DEPLOYED. Art. 5(1)(c) prohibition is absolute — "
                      "no mitigation is possible. Recommend immediate project termination."))
    _req(RISK_BASE, f"/v1/risks/{r1}", "PATCH", {"status": "confirmed"})
    approve_register(reg, False,
        "Residual risk is NOT acceptable. This system is categorically prohibited under "
        "EU AI Act Art. 5(1)(c). Project must be terminated. No deployment path exists.")
    print(f"  v1 approved ({reg})")

    # ── Loan Approval Automation — 1 version, HIGH, Overdue ──────────────────
    print("\nLoan Approval Automation (1 version, Overdue)…")
    reg = create_register(la_id,
        "Risk management for automated loan approval system covering retail lending decisions. "
        "Scope includes model bias, explainability of rejections, regulatory compliance with "
        "EU AI Act Art. 9 and EBA guidelines on ML in credit decisions.")
    r1 = add_risk(reg, title="Biased loan rejections based on protected demographic characteristics",
                  category="bias", severity="high", likelihood="likely", risk_type="foreseeable",
                  risk_owner="risk.management@company.com",
                  ai_lifecycle_phase="operation",
                  affects_vulnerable_groups=True,
                  vulnerable_groups='["people in financial difficulty","ethnic minorities"]',
                  impact="Systematic denial of credit to protected groups; regulatory and reputational risk.",
                  misuse_scenarios=[{"actor": "Loan officer", "description": "Use automated score to deny loan without mandatory human review", "likelihood": "possible", "consequence": "Discriminatory lending; regulatory violation", "vulnerable_group": "people in financial difficulty"}])
    confirm_risk(r1, "unlikely", "low",
                 review_notes="Residual bias risk acceptable after fairness constraints and mandatory human review. Third-party audit conducted quarterly.")
    add_mitigation(r1, "reduce", "Fairness constraints and quarterly bias audit",
                   "Demographic parity constraints in training; quarterly third-party bias audit.",
                   implementation_guidance="Demographic parity constraints embedded in training objective. Quarterly third-party bias audit with findings reported to risk committee.",
                   assigned_to="risk.management@company.com")
    approve_register(reg, True,
        "Fairness controls and mandatory human review reduce residual bias risk to acceptable level.")
    print(f"  v1 approved ({reg})")

    # ── Meeting Transcription Tool — 1 voluntary version ─────────────────────
    print("\nMeeting Transcription Tool (1 voluntary version)…")
    reg = create_register(mtt_id,
        "Voluntary risk management record for AI-powered meeting transcription tool. "
        "Scope covers: audio data privacy, transcription accuracy, PII handling in meeting content, "
        "and retention of recordings. Risk management is performed on a voluntary basis as the system "
        "falls under the minimal risk tier of the EU AI Act.",
        notes="Voluntary — system is minimal risk under EU AI Act.")
    r1 = add_risk(reg, title="Personal data in meeting recordings processed without explicit consent",
                  category="privacy", severity="medium", likelihood="possible", risk_type="known",
                  risk_owner="privacy.officer@company.com",
                  ai_lifecycle_phase="operation",
                  affects_vulnerable_groups=False,
                  impact="Recordings may contain sensitive personal data; GDPR compliance risk.",
                  misuse_scenarios=[{"actor": "Manager", "description": "Use transcription to monitor employee conversations without consent", "likelihood": "possible", "consequence": "Privacy violation; breach of employment law", "vulnerable_group": None}])
    confirm_risk(r1, "unlikely", "low",
                 review_notes="Residual privacy risk acceptable: consent controls implemented, opt-out available, deletion on request within 72h.")
    add_mitigation(r1, "mitigate", "Participant consent banner and opt-out mechanism",
                   "Notify all participants at recording start; provide opt-out; delete on request.",
                   implementation_guidance="Consent banner displayed in calendar invite and at recording start. Participants can opt out via link; recordings deleted within 72h on request.",
                   assigned_to="privacy.officer@company.com")
    approve_register(reg, True,
        "Residual privacy risk is acceptable after consent controls. "
        "This voluntary record documents due diligence beyond EU AI Act requirements for minimal risk systems.")
    print(f"  v1 approved ({reg})")

    print("\n── Setting realistic historical dates ──")
    print("  (Requires direct DB access via docker exec — skipping if not available)")
    _set_historical_dates(hr_id, cr_id, cs_id, md_id, ss_id, epa_id, kb_id, mtt_id, la_id)

    print("\n✅ Demo seed complete. 9 systems registered, risk registers populated.")
    print("   Open http://localhost:8080/risk-management/ to explore.")


def _set_historical_dates(hr_id, cr_id, cs_id, md_id, ss_id, epa_id, kb_id, mtt_id, la_id):
    """Back-date registers and triggers to simulate a realistic history."""
    import subprocess

    def psql(sql):
        result = subprocess.run(
            ["docker", "exec", "ai-trust-git-postgres-1",
             "psql", "-U", "postgres", "-d", "ai_trust", "-c", sql],
            capture_output=True, text=True
        )
        if result.returncode != 0:
            print(f"  SQL warning: {result.stderr.strip()[:100]}", file=sys.stderr)

    # HR: 4 versions — 14mo, 8mo, 2mo ago, 1 week ago
    hr_regs = [r["id"] for r in _req(RISK_BASE, f"/v1/systems/{hr_id}/registers")]
    offsets_hr = ["14 months", "8 months", "2 months", "1 week"]
    for reg_id, offset in zip(sorted(hr_regs), offsets_hr):
        psql(f"UPDATE risk_registers SET created_at=NOW()-INTERVAL '{offset}', "
             f"approved_at=NOW()-INTERVAL '{offset}', "
             f"last_assessment_completed_at=NOW()-INTERVAL '{offset}', "
             f"updated_at=NOW()-INTERVAL '{offset}' WHERE id='{reg_id}';")

    # Credit Risk: 3 versions — 12mo, 6mo, 5mo ago
    cr_regs = [r["id"] for r in _req(RISK_BASE, f"/v1/systems/{cr_id}/registers")]
    for reg_id, offset in zip(sorted(cr_regs), ["12 months", "6 months", "5 months"]):
        psql(f"UPDATE risk_registers SET created_at=NOW()-INTERVAL '{offset}', "
             f"approved_at=NOW()-INTERVAL '{offset}', "
             f"last_assessment_completed_at=NOW()-INTERVAL '{offset}', "
             f"updated_at=NOW()-INTERVAL '{offset}' WHERE id='{reg_id}';")
    # Credit Risk trigger: 6-month trigger fired 1 month ago, unacknowledged → REOPEN
    psql(f"UPDATE reassessment_triggers SET acknowledged=true WHERE ai_system_id='{cr_id}';")
    psql(f"INSERT INTO reassessment_triggers "
         f"(id,ai_system_id,trigger_type,trigger_reason,triggered_at,acknowledged) VALUES "
         f"('TRG-DEMO-CR01','{cr_id}','scheduled_6_month',"
         f"'Scheduled 6-month re-assessment due (Art. 9(1)).',"
         f"NOW()-INTERVAL '1 month',false);")

    # Customer Support: 2 versions — 12mo, 9mo ago → most recent >6mo → Overdue badge, Reopen button
    cs_regs = [r["id"] for r in _req(RISK_BASE, f"/v1/systems/{cs_id}/registers")]
    for reg_id, offset in zip(sorted(cs_regs), ["12 months", "9 months"]):
        psql(f"UPDATE risk_registers SET created_at=NOW()-INTERVAL '{offset}', "
             f"approved_at=NOW()-INTERVAL '{offset}', "
             f"last_assessment_completed_at=NOW()-INTERVAL '{offset}', "
             f"updated_at=NOW()-INTERVAL '{offset}' WHERE id='{reg_id}';")
    psql(f"UPDATE reassessment_triggers SET acknowledged=true WHERE ai_system_id='{cs_id}';")

    # Medical Imaging: 2 approved — 13mo, 1mo ago; v3 draft stays recent
    md_regs = _req(RISK_BASE, f"/v1/systems/{md_id}/registers")
    approved = [r["id"] for r in md_regs if r["status"] == "approved"]
    for reg_id, offset in zip(sorted(approved), ["13 months", "1 month"]):
        psql(f"UPDATE risk_registers SET created_at=NOW()-INTERVAL '{offset}', "
             f"approved_at=NOW()-INTERVAL '{offset}', "
             f"last_assessment_completed_at=NOW()-INTERVAL '{offset}', "
             f"updated_at=NOW()-INTERVAL '{offset}' WHERE id='{reg_id}';")
    psql(f"UPDATE reassessment_triggers SET acknowledged=true WHERE ai_system_id='{md_id}';")

    # Social Scoring: acknowledge all triggers
    psql(f"UPDATE reassessment_triggers SET acknowledged=true WHERE ai_system_id='{ss_id}';")
    psql(f"UPDATE reassessment_triggers SET acknowledged=true WHERE ai_system_id='{hr_id}';")
    # Employee Performance Analytics: no register, acknowledge any auto-created triggers
    psql(f"UPDATE reassessment_triggers SET acknowledged=true WHERE ai_system_id='{epa_id}';")
    # Minimal risk systems: acknowledge all triggers (risk management is optional)
    psql(f"UPDATE reassessment_triggers SET acknowledged=true WHERE ai_system_id='{kb_id}';")
    psql(f"UPDATE reassessment_triggers SET acknowledged=true WHERE ai_system_id='{mtt_id}';")
    # Loan Approval: 1 version — 8 months ago → Overdue (>6 months)
    la_regs = [r["id"] for r in _req(RISK_BASE, f"/v1/systems/{la_id}/registers")]
    for reg_id in la_regs:
        psql(f"UPDATE risk_registers SET created_at=NOW()-INTERVAL '8 months', "
             f"approved_at=NOW()-INTERVAL '8 months', "
             f"last_assessment_completed_at=NOW()-INTERVAL '8 months', "
             f"updated_at=NOW()-INTERVAL '8 months' WHERE id='{reg_id}';")
    psql(f"UPDATE reassessment_triggers SET acknowledged=true WHERE ai_system_id='{la_id}';")

    print("  Dates updated.")


if __name__ == "__main__":
    main()
