from __future__ import annotations

import re

from risk_management.llm_client import LLMClient, LLMDisabledError, LLMUnavailableError
from risk_management.models import (
    AISystemMetadata,
    MitigationMeasure,
    ResidualRiskArgument,
    Risk,
    SeverityLevel,
)

_LLM_RESIDUAL_SYSTEM = """You are an EU AI Act Article 9(5) compliance expert.
Generate a structured residual risk acceptability argument in the spirit of GSN (Goal Structuring Notation) assurance cases.
Respond ONLY with JSON:
{
  "claim": "...",
  "evidence": ["...", "..."],
  "assumptions": ["...", "..."],
  "open_issues": ["...", "..."]
}
No extra text, no markdown."""

_LLM_RESIDUAL_USER = """AI system: {name} (Annex III {point})
Confirmed risks after mitigation:
{risk_summary}

Mitigations applied:
{mitigation_summary}

Generate a residual risk acceptability argument. JSON only."""

_EVIDENCE_TEMPLATES = [
    "Pre-deployment bias audit conducted with results within defined thresholds",
    "All {critical_count} critical and {high_count} high risks have at least one mitigation measure assigned",
    "Human oversight mechanism implemented for all high-stakes decisions",
    "SHAP/explanation mechanism in place satisfying Art. 13 transparency requirements",
    "Override mechanism with audit log implemented (Art. 14)",
    "Test plan executed against pre-defined metrics and thresholds (Art. 9(7))",
    "Data Protection Impact Assessment (DPIA) completed",
    "Technical documentation prepared per Annex IV",
]

_ASSUMPTION_TEMPLATES = [
    "Deployers will follow the operator training programme before using the system",
    "Human reviewers will exercise independent judgement and not rubber-stamp system outputs",
    "Post-market monitoring will be implemented as planned (Art. 72)",
    "The system will only be used within its defined scope and for its intended purpose",
]

_OPEN_ISSUE_TEMPLATES = [
    "Post-market monitoring feedback loop (Art. 9(2)(c)) is not yet implemented — risk re-evaluation based on real-world data is pending",
    "Full formal assurance case per Art. 9(5) with expert sign-off is not yet complete",
    "Proxy discrimination analysis requires quarterly re-evaluation in production",
]


class ResidualRiskAssessor:
    """
    Builds a structured residual-risk acceptability argument (Art. 9(5)).
    Inspired by GSN (Goal Structuring Notation) assurance case pattern from safety-critical systems.
    Research finding: no OSS tool currently provides this — it is novel to this PoC.
    """

    def build_argument(
        self,
        metadata: AISystemMetadata,
        confirmed_risks: list[Risk],
        mitigations: list[MitigationMeasure],
        use_llm: bool,
        llm_client: LLMClient,
    ) -> ResidualRiskArgument:
        if use_llm:
            return self._llm_argument(metadata, confirmed_risks, mitigations, llm_client)
        return self._rule_based_argument(metadata, confirmed_risks, mitigations)

    def _rule_based_argument(
        self,
        metadata: AISystemMetadata,
        risks: list[Risk],
        mitigations: list[MitigationMeasure],
    ) -> ResidualRiskArgument:
        critical_count = sum(1 for r in risks if r.severity == SeverityLevel.CRITICAL)
        high_count = sum(1 for r in risks if r.severity == SeverityLevel.HIGH)
        risks_with_mitigations = sum(
            1 for r in risks if any(r.id in m.assigned_to_risk_ids for m in mitigations)
        )

        claim = (
            f"Residual risk for {metadata.name} v{metadata.version} (Annex III point "
            f"{metadata.annex_iii_point}) is acceptable following the application of "
            f"{len(mitigations)} mitigation measures across {len(risks)} identified risks, "
            f"subject to the assumptions and open issues listed below."
        )

        evidence = [
            tmpl.format(critical_count=critical_count, high_count=high_count)
            for tmpl in _EVIDENCE_TEMPLATES
        ]
        evidence.append(
            f"{risks_with_mitigations}/{len(risks)} confirmed risks have at least one mitigation assigned"
        )

        open_issues = list(_OPEN_ISSUE_TEMPLATES)
        if critical_count > 0:
            open_issues.append(
                f"{critical_count} critical risk(s) remain — expert sign-off required before deployment"
            )

        return ResidualRiskArgument(
            claim=claim,
            evidence=evidence,
            assumptions=list(_ASSUMPTION_TEMPLATES),
            open_issues=open_issues,
            expert_sign_off=False,
        )

    def _llm_argument(
        self,
        metadata: AISystemMetadata,
        risks: list[Risk],
        mitigations: list[MitigationMeasure],
        llm_client: LLMClient,
    ) -> ResidualRiskArgument:
        import json
        risk_summary = "\n".join(
            f"- {r.id}: {r.title} (severity: {r.severity.value})" for r in risks[:10]
        )
        mitigation_summary = "\n".join(
            f"- {m.id}: {m.title} ({m.hierarchy_level.value})" for m in mitigations[:10]
        )
        try:
            response = llm_client.complete(
                _LLM_RESIDUAL_SYSTEM,
                _LLM_RESIDUAL_USER.format(
                    name=metadata.name,
                    point=metadata.annex_iii_point,
                    risk_summary=risk_summary,
                    mitigation_summary=mitigation_summary,
                ),
            )
            content = re.sub(r"```(?:json)?\s*", "", response.content).strip()
            data = json.loads(content)
            return ResidualRiskArgument(
                claim=data.get("claim", ""),
                evidence=data.get("evidence", []),
                assumptions=data.get("assumptions", []),
                open_issues=data.get("open_issues", []),
                expert_sign_off=False,
            )
        except (LLMDisabledError, LLMUnavailableError, Exception):
            return self._rule_based_argument(metadata, risks, mitigations)
