from __future__ import annotations

import json
import re

from risk_management.llm_client import LLMClient, LLMDisabledError, LLMUnavailableError
from risk_management.models import AISystemMetadata, Risk, VulnerableGroupAssessment

# Vulnerable group definitions with detection keywords
_VULNERABLE_GROUPS = {
    "minors (under 18)": [
        "minor", "child", "children", "under 18", "under-18", "juvenile",
        "young person", "school", "education", "student", "pupil",
    ],
    "elderly": [
        "elderly", "older adult", "senior citizen", "aged", "pensioner",
        "retirement", "nursing home",
    ],
    "people with disabilities": [
        "disability", "disabled", "impairment", "accessibility", "special needs",
        "cognitive impairment", "visual impairment", "hearing impairment",
    ],
    "individuals in financial distress": [
        "financial distress", "debt", "bankrupt", "low income", "benefit recipient",
        "welfare", "poverty", "unemployed", "social assistance",
    ],
    "ethnic and racial minorities": [
        "ethnic", "minority", "race", "racial", "immigration", "immigrant",
        "asylum seeker", "refugee", "foreign national",
    ],
    "women and gender minorities": [
        "gender", "women", "female", "maternity", "pregnancy", "lgbtq",
        "gender minority", "non-binary",
    ],
    "non-native language speakers": [
        "language barrier", "non-native", "translation", "multilingual",
        "limited english", "foreign language",
    ],
    "people with mental health conditions": [
        "mental health", "psychiatric", "depression", "anxiety", "neurodiversity",
        "autism", "adhd",
    ],
    "low-literacy individuals": [
        "low literacy", "digital literacy", "low education", "basic skills",
    ],
}

# Default safeguards that apply to all vulnerable groups
_UNIVERSAL_SAFEGUARDS = [
    "Mandatory human review for decisions affecting this group (Art. 9(9))",
    "Plain-language decision notices accessible to this group",
    "Specific performance metrics evaluated for this group",
    "Complaint and redress mechanism accessible to this group",
]

# Group-specific additional safeguards
_GROUP_SAFEGUARDS: dict[str, list[str]] = {
    "minors (under 18)": [
        "Age verification or flagging mechanism at input",
        "Parental/guardian notification for significant decisions",
        "Stricter human review threshold (lower confidence required for automated decision)",
        "Child-specific rights assessment under Art. 9(9)",
    ],
    "elderly": [
        "Accessible interface design (larger text, simplified language)",
        "Alternative non-digital contact channel available",
    ],
    "people with disabilities": [
        "WCAG 2.1 AA accessibility compliance for all interfaces",
        "Alternative format outputs on request",
        "Disability flag routing to specialist human reviewer",
    ],
    "individuals in financial distress": [
        "Enhanced human review for adverse decisions",
        "Referral pathway to support services included in decision notice",
    ],
    "ethnic and racial minorities": [
        "Disaggregated fairness metrics for this group",
        "Proxy discrimination analysis (postcode, surname, sector)",
        "Periodic bias audit including this group",
    ],
}

_LLM_VG_SYSTEM = """You are an EU AI Act Art. 9(9) expert.
Identify which vulnerable groups could be disproportionately affected by adverse decisions from this AI system.
Respond ONLY with a JSON array of group names (strings). No explanation, no markdown."""

_LLM_VG_USER = """AI system: {name}, purpose: {purpose}
Deployment: {deployment}
Known risks: {risk_titles}
List vulnerable groups as a JSON array."""


class VulnerableGroupChecker:
    """
    Dedicated Art. 9(9) checkpoint: identifies and assesses impacts on vulnerable groups.
    This was flagged as a gap in all OSS tools reviewed in the research.
    """

    def assess(
        self,
        metadata: AISystemMetadata,
        risks: list[Risk],
        system_description: str,
        use_llm: bool,
        llm_client: LLMClient,
    ) -> list[VulnerableGroupAssessment]:
        detected: dict[str, VulnerableGroupAssessment] = {}

        # Rule-based detection from description + metadata + risk content
        combined = " ".join([
            system_description,
            metadata.intended_purpose,
            metadata.deployment_context,
            " ".join(metadata.intended_users),
            " ".join(r.title + " " + r.description for r in risks),
        ]).lower()

        for group, keywords in _VULNERABLE_GROUPS.items():
            if any(kw in combined for kw in keywords):
                risk_ids = [r.id for r in risks if any(kw in (r.title + r.description).lower() for kw in keywords)]
                safeguards = _UNIVERSAL_SAFEGUARDS + _GROUP_SAFEGUARDS.get(group, [])
                detected[group] = VulnerableGroupAssessment(
                    group=group,
                    identified_by="rule_based",
                    risk_ids=risk_ids,
                    specific_safeguards=safeguards,
                )

        # Also pull from existing risk vulnerable_groups fields
        for risk in risks:
            for vg in risk.vulnerable_groups:
                norm = vg.lower().strip()
                if norm not in detected:
                    detected[norm] = VulnerableGroupAssessment(
                        group=vg,
                        identified_by="rule_based",
                        risk_ids=[risk.id],
                        specific_safeguards=_UNIVERSAL_SAFEGUARDS,
                    )

        # LLM supplement
        if use_llm:
            try:
                risk_titles = ", ".join(r.title for r in risks[:8])
                response = llm_client.complete(
                    _LLM_VG_SYSTEM,
                    _LLM_VG_USER.format(
                        name=metadata.name,
                        purpose=metadata.intended_purpose,
                        deployment=metadata.deployment_context,
                        risk_titles=risk_titles,
                    ),
                )
                content = re.sub(r"```(?:json)?\s*", "", response.content).strip()
                llm_groups = json.loads(content)
                for group in llm_groups:
                    if isinstance(group, str) and group.lower() not in detected:
                        detected[group.lower()] = VulnerableGroupAssessment(
                            group=group,
                            identified_by="llm",
                            specific_safeguards=_UNIVERSAL_SAFEGUARDS,
                        )
            except (LLMDisabledError, LLMUnavailableError, Exception):
                pass

        return list(detected.values())
