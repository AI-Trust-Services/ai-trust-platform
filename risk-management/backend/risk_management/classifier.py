from __future__ import annotations

import re

from risk_management.llm_client import LLMClient, LLMDisabledError, LLMUnavailableError
from risk_management.models import AISystemMetadata, AnnexIIICategory, RiskClassification

# Annex III category → risk level and point mapping
_ANNEX_III_HIGH_RISK = {
    AnnexIIICategory.BIOMETRIC: ("high", "1"),
    AnnexIIICategory.CRITICAL_INFRASTRUCTURE: ("high", "2"),
    AnnexIIICategory.EDUCATION: ("high", "3"),
    AnnexIIICategory.EMPLOYMENT: ("high", "4"),
    AnnexIIICategory.ESSENTIAL_SERVICES: ("high", "5"),
    AnnexIIICategory.LAW_ENFORCEMENT: ("high", "6"),
    AnnexIIICategory.MIGRATION: ("high", "7"),
    AnnexIIICategory.JUSTICE: ("high", "8"),
}

# Keywords suggesting unacceptable practices (Annex VI / Art. 5)
_UNACCEPTABLE_KEYWORDS = [
    "subliminal manipulation", "social scoring", "real-time biometric",
    "emotion recognition workplace", "predictive policing individual",
    "mass surveillance", "exploit vulnerabilities", "racial profiling",
]

# Keywords suggesting minimal / limited risk
_MINIMAL_KEYWORDS = [
    "spam filter", "ai in video game", "ai-enabled search engine",
    "recommendation system", "inventory management", "scheduling",
]

_LLM_CLASSIFY_SYSTEM = """You are an EU AI Act compliance expert.
Classify the AI system's risk level under the EU AI Act.
Respond ONLY with JSON: {"risk_level": "...", "reasoning": "...", "confidence": "..."}
risk_level must be one of: "unacceptable", "high", "limited", "minimal"
confidence must be one of: "high", "medium", "low"
No extra text."""

_LLM_CLASSIFY_USER = """AI system: {name}
Annex III category: {category} (point {point})
Purpose: {purpose}
Deployment: {deployment}
Techniques: {techniques}

Classify the EU AI Act risk level. JSON only."""


class RiskClassifier:
    """
    Classifies an AI system's risk level under the EU AI Act.
    Inspired by EuConform and GetRegula patterns.
    Rule-based path always runs; LLM supplements reasoning if enabled.
    """

    def classify(
        self,
        metadata: AISystemMetadata,
        system_description: str,
        use_llm: bool,
        llm_client: LLMClient,
    ) -> RiskClassification:
        # Rule-based classification
        result = self._rule_based(metadata, system_description)

        if use_llm and result.confidence != "high":
            result = self._llm_classify(metadata, result, llm_client)

        return result

    def _rule_based(self, metadata: AISystemMetadata, description: str) -> RiskClassification:
        text = (description + " " + metadata.intended_purpose + " " + metadata.deployment_context).lower()

        # Check unacceptable practices first
        for kw in _UNACCEPTABLE_KEYWORDS:
            if kw in text:
                return RiskClassification(
                    risk_level="unacceptable",
                    annex_iii_match=False,
                    reasoning=f"Description contains indicator of potentially unacceptable practice: '{kw}'. Requires legal review.",
                    confidence="medium",
                )

        # Check Annex III high-risk categories
        if metadata.annex_iii_category in _ANNEX_III_HIGH_RISK:
            level, point = _ANNEX_III_HIGH_RISK[metadata.annex_iii_category]
            return RiskClassification(
                risk_level=level,
                annex_iii_match=True,
                annex_iii_point=metadata.annex_iii_point or point,
                reasoning=f"System is classified under Annex III, category '{metadata.annex_iii_category.value}' — automatically high-risk under EU AI Act.",
                confidence="high",
            )

        # Check minimal risk keywords
        for kw in _MINIMAL_KEYWORDS:
            if kw in text:
                return RiskClassification(
                    risk_level="minimal",
                    annex_iii_match=False,
                    reasoning=f"System description suggests minimal-risk application ('{kw}'). No Annex III match found.",
                    confidence="medium",
                )

        # Default: limited risk with low confidence
        return RiskClassification(
            risk_level="limited",
            annex_iii_match=False,
            reasoning="No Annex III category match found. Classified as limited risk by default — verify manually.",
            confidence="low",
        )

    def _llm_classify(
        self,
        metadata: AISystemMetadata,
        rule_result: RiskClassification,
        llm_client: LLMClient,
    ) -> RiskClassification:
        import json, re as _re
        try:
            response = llm_client.complete(
                _LLM_CLASSIFY_SYSTEM,
                _LLM_CLASSIFY_USER.format(
                    name=metadata.name,
                    category=metadata.annex_iii_category.value,
                    point=metadata.annex_iii_point,
                    purpose=metadata.intended_purpose,
                    deployment=metadata.deployment_context,
                    techniques=", ".join(metadata.ai_techniques),
                ),
            )
            content = _re.sub(r"```(?:json)?\s*", "", response.content).strip()
            data = json.loads(content)
            return RiskClassification(
                risk_level=data.get("risk_level", rule_result.risk_level),
                annex_iii_match=rule_result.annex_iii_match,
                annex_iii_point=rule_result.annex_iii_point,
                reasoning=data.get("reasoning", rule_result.reasoning),
                confidence=data.get("confidence", "medium"),
            )
        except (LLMDisabledError, LLMUnavailableError, Exception):
            return rule_result
