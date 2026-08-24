from __future__ import annotations

import uuid
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field

from risk_management.models import (
    AISystemMetadata,
    AnnexIIICategory,
    Risk,
    SeverityLevel,
    VulnerableGroupAssessment,
)


class DPIAProcessingActivity(BaseModel):
    activity: str
    legal_basis: str
    personal_data_categories: list[str] = Field(default_factory=list)
    data_subjects: list[str] = Field(default_factory=list)
    retention_period: str = ""
    third_party_transfers: list[str] = Field(default_factory=list)


class DPIARisk(BaseModel):
    id: str = Field(default_factory=lambda: f"DPIA-RISK-{uuid.uuid4().hex[:6].upper()}")
    threat: str
    likelihood: str  # high / medium / low
    severity: str    # high / medium / low
    residual_risk: str  # high / medium / low
    mitigation: str
    gdpr_article: str = ""


class DPIAReport(BaseModel):
    id: str = Field(default_factory=lambda: f"DPIA-{uuid.uuid4().hex[:8].upper()}")
    created_at: datetime = Field(default_factory=datetime.utcnow)
    system_name: str
    system_version: str
    controller: str
    dpo_consulted: bool = False
    supervisory_authority_consultation_required: bool = False
    supervisory_authority_consultation_reason: str = ""
    processing_activities: list[DPIAProcessingActivity] = Field(default_factory=list)
    risks: list[DPIARisk] = Field(default_factory=list)
    overall_risk_level: str = "medium"  # high / medium / low
    conclusion: str = ""
    approved: bool = False
    approver: str = ""
    review_date: str = ""
    linked_risk_register_id: str = ""
    generated_by: str = "ai_trust_risk_management"


# ── Processing activity templates per Annex III category ────────────────────

_PROCESSING_TEMPLATES: dict[str, list[DPIAProcessingActivity]] = {
    "employment": [
        DPIAProcessingActivity(
            activity="Automated CV screening and ranking",
            legal_basis="Art. 6(1)(f) GDPR — legitimate interest of the controller; or Art. 6(1)(b) — processing necessary for the performance of a contract",
            personal_data_categories=["CV / resume data", "employment history", "educational qualifications", "contact details"],
            data_subjects=["job applicants"],
            retention_period="Application period + 6 months (unless consent obtained for longer retention)",
            third_party_transfers=["Applicant Tracking System (ATS) vendor"],
        ),
        DPIAProcessingActivity(
            activity="Automated decision-making with significant effects on data subjects",
            legal_basis="Art. 22 GDPR — explicit consent or necessity for contract",
            personal_data_categories=["profile scores", "ranking outputs", "model explanations"],
            data_subjects=["job applicants"],
            retention_period="Duration of recruitment process",
            third_party_transfers=[],
        ),
    ],
    "essential_services": [
        DPIAProcessingActivity(
            activity="Automated credit scoring or benefit eligibility assessment",
            legal_basis="Art. 6(1)(b) GDPR — necessity for contract; Art. 22 GDPR for solely automated decisions",
            personal_data_categories=["financial history", "transaction data", "identity data", "contact details"],
            data_subjects=["customers", "applicants"],
            retention_period="Duration of contract + statutory minimum (typically 5–7 years)",
            third_party_transfers=["credit reference agencies", "fraud prevention databases"],
        ),
    ],
    "education": [
        DPIAProcessingActivity(
            activity="AI-assisted assessment or adaptive learning",
            legal_basis="Art. 6(1)(e) GDPR — public interest task (educational institutions)",
            personal_data_categories=["student performance data", "behavioural data", "assessment results"],
            data_subjects=["students", "pupils"],
            retention_period="Duration of enrolment + archiving period per national law",
            third_party_transfers=["EdTech platform providers"],
        ),
    ],
    "law_enforcement": [
        DPIAProcessingActivity(
            activity="AI-assisted risk profiling or identification",
            legal_basis="Law Enforcement Directive (2016/680) — Art. 8 — processing for law enforcement purposes",
            personal_data_categories=["biometric data", "criminal records", "behavioural data", "location data"],
            data_subjects=["suspects", "witnesses", "general public"],
            retention_period="Statutory retention periods under national law",
            third_party_transfers=["other law enforcement agencies", "Europol / Interpol (international transfers)"],
        ),
    ],
    "biometric": [
        DPIAProcessingActivity(
            activity="Collection and processing of biometric data for identification",
            legal_basis="Art. 9(2)(a) GDPR — explicit consent; or Art. 9(2)(g) — substantial public interest",
            personal_data_categories=["facial recognition data", "fingerprint data", "iris scan data"],
            data_subjects=["employees", "visitors", "general public"],
            retention_period="Minimum necessary — delete promptly after purpose is fulfilled",
            third_party_transfers=["biometric data processor", "identity verification vendor"],
        ),
    ],
    "other": [
        DPIAProcessingActivity(
            activity="AI-assisted processing of personal data",
            legal_basis="Art. 6(1) GDPR — specify applicable basis",
            personal_data_categories=["personal data relevant to intended purpose"],
            data_subjects=["data subjects affected by system outputs"],
            retention_period="Minimum necessary for the stated purpose",
            third_party_transfers=[],
        ),
    ],
}

# ── DPIA risk templates based on risk register ───────────────────────────────

_RISK_CATEGORY_TO_DPIA: dict[str, list[dict]] = {
    "bias": [
        {
            "threat": "Discriminatory outputs based on protected characteristics",
            "likelihood": "high",
            "severity": "high",
            "residual_risk": "medium",
            "mitigation": "Bias audit before deployment; ongoing fairness monitoring; human override mechanism",
            "gdpr_article": "Art. 9 GDPR — special category data; Art. 22(3) — safeguards for automated decisions",
        }
    ],
    "privacy": [
        {
            "threat": "Unlawful processing or excessive collection of personal data",
            "likelihood": "medium",
            "severity": "high",
            "residual_risk": "low",
            "mitigation": "Data minimisation; purpose limitation; privacy-by-design controls",
            "gdpr_article": "Art. 5(1)(b)(c) GDPR — purpose limitation and data minimisation",
        }
    ],
    "transparency": [
        {
            "threat": "Individuals unable to understand or contest automated decisions",
            "likelihood": "high",
            "severity": "medium",
            "residual_risk": "low",
            "mitigation": "Explainability layer; mandatory human-readable explanations; right to explanation procedure",
            "gdpr_article": "Art. 13–14 GDPR — information obligations; Art. 22(3) — right to explanation",
        }
    ],
    "human_oversight": [
        {
            "threat": "Absence of meaningful human oversight over consequential AI decisions",
            "likelihood": "medium",
            "severity": "high",
            "residual_risk": "low",
            "mitigation": "Mandatory human review for high-severity cases; override logging; escalation path",
            "gdpr_article": "Art. 22 GDPR — right not to be subject to solely automated decision-making",
        }
    ],
    "security": [
        {
            "threat": "Unauthorised access to personal data used by or generated by the AI system",
            "likelihood": "medium",
            "severity": "high",
            "residual_risk": "low",
            "mitigation": "Encryption at rest and in transit; access controls; penetration testing",
            "gdpr_article": "Art. 32 GDPR — security of processing",
        }
    ],
    "data_quality": [
        {
            "threat": "Inaccurate or incomplete data leading to incorrect decisions affecting data subjects",
            "likelihood": "medium",
            "severity": "medium",
            "residual_risk": "low",
            "mitigation": "Data quality checks; rectification procedure; data subject access rights implementation",
            "gdpr_article": "Art. 5(1)(d) GDPR — accuracy; Art. 16 GDPR — right to rectification",
        }
    ],
}


class DPIAAssessor:
    """
    Generates a DPIA (Data Protection Impact Assessment) report from a risk register.
    Implements GDPR Article 35 requirements for high-risk AI systems.
    """

    def assess(
        self,
        metadata: AISystemMetadata,
        confirmed_risks: list[Risk],
        vg_assessments: list[VulnerableGroupAssessment],
        linked_register_id: str = "",
    ) -> DPIAReport:
        category_key = metadata.annex_iii_category.value
        processing_activities = list(
            _PROCESSING_TEMPLATES.get(category_key, _PROCESSING_TEMPLATES["other"])
        )

        dpia_risks: list[DPIARisk] = []
        seen_threats: set[str] = set()

        for risk in confirmed_risks:
            templates = _RISK_CATEGORY_TO_DPIA.get(risk.category, [])
            for t in templates:
                threat = t["threat"]
                if threat not in seen_threats:
                    seen_threats.add(threat)
                    # Escalate residual_risk if severity is critical
                    residual = t["residual_risk"]
                    if risk.severity == SeverityLevel.CRITICAL and residual == "medium":
                        residual = "high"
                    dpia_risks.append(DPIARisk(
                        threat=threat,
                        likelihood=t["likelihood"],
                        severity=t["severity"],
                        residual_risk=residual,
                        mitigation=t["mitigation"],
                        gdpr_article=t.get("gdpr_article", ""),
                    ))

        # Always include a profiling risk for Annex III systems
        if not any("profiling" in r.threat.lower() or "automated decision" in r.threat.lower() for r in dpia_risks):
            dpia_risks.append(DPIARisk(
                threat="Rights and freedoms affected by automated processing (profiling / automated decision-making)",
                likelihood="medium",
                severity="high",
                residual_risk="medium",
                mitigation="Art. 22 safeguards: explicit consent or contract necessity; human review option; right to explanation procedure",
                gdpr_article="Art. 22 GDPR — automated individual decision-making, including profiling",
            ))

        high_residual = sum(1 for r in dpia_risks if r.residual_risk == "high")
        overall = "high" if high_residual >= 2 else ("medium" if high_residual == 1 else "low")

        # Supervisory authority consultation required if overall risk remains high after mitigation
        sa_required = overall == "high"
        sa_reason = (
            "Residual risk remains HIGH after proposed mitigations. "
            "Prior consultation with the supervisory authority is required under Art. 36 GDPR."
            if sa_required else ""
        )

        conclusion = self._build_conclusion(metadata, dpia_risks, overall, vg_assessments, sa_required)

        return DPIAReport(
            system_name=metadata.name,
            system_version=metadata.version,
            controller=metadata.developer_org or "To be specified",
            supervisory_authority_consultation_required=sa_required,
            supervisory_authority_consultation_reason=sa_reason,
            processing_activities=processing_activities,
            risks=dpia_risks,
            overall_risk_level=overall,
            conclusion=conclusion,
            linked_risk_register_id=linked_register_id,
        )

    def _build_conclusion(
        self,
        metadata: AISystemMetadata,
        risks: list[DPIARisk],
        overall: str,
        vg_assessments: list[VulnerableGroupAssessment],
        sa_required: bool,
    ) -> str:
        parts = [
            f"This DPIA covers {metadata.name} v{metadata.version}, "
            f"classified as Annex III ({metadata.annex_iii_category.value.replace('_', ' ')}) under the EU AI Act. "
            f"{len(risks)} data protection risk(s) were identified."
        ]
        if overall == "high":
            parts.append(
                "Overall residual risk is assessed as HIGH. Deployment must not proceed until "
                "additional mitigations reduce the residual risk to an acceptable level "
                "and/or prior consultation with the supervisory authority is completed."
            )
        elif overall == "medium":
            parts.append(
                "Overall residual risk is MEDIUM. Deployment may proceed subject to "
                "implementation of all identified mitigations and ongoing monitoring."
            )
        else:
            parts.append(
                "Overall residual risk is LOW. Deployment may proceed subject to "
                "standard data protection controls and periodic review."
            )
        if vg_assessments:
            groups = ", ".join(vga.group for vga in vg_assessments)
            parts.append(
                f"Special attention is required for vulnerable groups: {groups}. "
                "Specific safeguards must be in place before processing their data."
            )
        if sa_required:
            parts.append(
                "Prior consultation with the competent supervisory authority is required "
                "under Article 36 GDPR before processing commences."
            )
        return " ".join(parts)

    def to_markdown(self, report: DPIAReport) -> str:
        lines: list[str] = [
            f"# Data Protection Impact Assessment",
            f"## {report.system_name} v{report.system_version}",
            "",
            f"| Field | Value |",
            f"|-------|-------|",
            f"| DPIA ID | {report.id} |",
            f"| Date | {report.created_at.strftime('%Y-%m-%d')} |",
            f"| Controller | {report.controller} |",
            f"| Overall Risk Level | **{report.overall_risk_level.upper()}** |",
            f"| SA Consultation Required | {'**YES** — see section 5' if report.supervisory_authority_consultation_required else 'No'} |",
            f"| Linked Risk Register | {report.linked_risk_register_id or 'N/A'} |",
            "",
            "## 1. Processing Activities",
            "",
        ]
        for i, pa in enumerate(report.processing_activities, 1):
            lines += [
                f"### {i}. {pa.activity}",
                "",
                f"- **Legal basis**: {pa.legal_basis}",
                f"- **Personal data categories**: {', '.join(pa.personal_data_categories)}",
                f"- **Data subjects**: {', '.join(pa.data_subjects)}",
                f"- **Retention**: {pa.retention_period}",
            ]
            if pa.third_party_transfers:
                lines.append(f"- **Third-party transfers**: {', '.join(pa.third_party_transfers)}")
            lines.append("")

        lines += [
            "## 2. Identified Risks and Mitigations",
            "",
            "| Risk | Likelihood | Severity | Residual Risk | GDPR Article |",
            "|------|------------|----------|---------------|--------------|",
        ]
        for r in report.risks:
            lines.append(
                f"| {r.threat} | {r.likelihood} | {r.severity} | **{r.residual_risk}** | {r.gdpr_article} |"
            )
        lines.append("")

        lines += ["## 3. Mitigation Measures", ""]
        for r in report.risks:
            lines += [f"**{r.threat}**", "", f"{r.mitigation}", ""]

        lines += [
            "## 4. Conclusion",
            "",
            report.conclusion,
            "",
        ]

        if report.supervisory_authority_consultation_required:
            lines += [
                "## 5. Prior Supervisory Authority Consultation (Art. 36 GDPR)",
                "",
                f"> {report.supervisory_authority_consultation_reason}",
                "",
            ]

        lines += [
            "---",
            "",
            "*This DPIA was generated automatically by the AI Trust Risk Management module.*",
            "*It must be reviewed and approved by the Data Protection Officer before deployment.*",
            "",
        ]
        return "\n".join(lines)
