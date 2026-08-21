from __future__ import annotations

import json
import re
import uuid
from typing import Any

from risk_management.llm_client import LLMClient, LLMDisabledError, LLMUnavailableError
from risk_management.models import (
    AISystemMetadata,
    LikelihoodLevel,
    MisuseScenario,
    Risk,
    SeverityLevel,
    composite_severity,
)

# Vulnerable group keywords for rule-based detection
_VULNERABLE_KEYWORDS: dict[str, list[str]] = {
    "minors": ["minor", "child", "children", "under 18", "under-18", "juvenile", "young person"],
    "elderly": ["elderly", "older adults", "senior", "aged", "pensioner"],
    "people with disabilities": ["disability", "disabled", "impairment", "accessibility", "special needs"],
    "individuals in financial distress": ["financial distress", "debt", "bankrupt", "low income", "benefit recipient", "welfare"],
    "ethnic minorities": ["ethnic", "minority", "race", "racial", "immigration", "immigrant", "asylum"],
    "women": ["gender", "women", "female", "maternity", "pregnancy"],
    "non-native speakers": ["language barrier", "non-native", "translation", "multilingual"],
}

# Misuse scenario templates by risk category
_MISUSE_TEMPLATES: dict[str, list[dict]] = {
    "bias": [
        {
            "description": "A malicious operator deliberately uses the system to screen out candidates from a specific demographic group by targeting use cases where the model's known bias produces systematically lower scores.",
            "actor": "Malicious operator",
            "vulnerable_group": "ethnic minorities",
            "likelihood": "possible",
            "consequence": "Systematic discrimination against a protected group, constituting unlawful treatment under EU non-discrimination law.",
        },
        {
            "description": "An operator expands system use to new geographic regions without revalidating fairness metrics, applying a model trained on one demographic context to a significantly different population.",
            "actor": "Negligent operator",
            "vulnerable_group": "underrepresented groups",
            "likelihood": "likely",
            "consequence": "Increased bias disparities in the new deployment context due to distribution shift compounding existing model bias.",
        },
    ],
    "security": [
        {
            "description": "An attacker submits carefully crafted inputs designed to push their application score above the approval threshold, exploiting knowledge of the model's decision boundary obtained through repeated queries.",
            "actor": "Malicious third party",
            "vulnerable_group": None,
            "likelihood": "possible",
            "consequence": "Fraudulent approvals that cause financial or operational harm to the deploying organisation.",
        },
        {
            "description": "An insider threat with access to the inference API extracts the model by submitting a large volume of queries and using the responses to train a surrogate model.",
            "actor": "Malicious insider",
            "vulnerable_group": None,
            "likelihood": "unlikely",
            "consequence": "Intellectual property theft and potential re-use of the model in an uncontrolled context without safety mitigations.",
        },
    ],
    "privacy": [
        {
            "description": "A third party submits membership inference queries to determine whether a specific individual's data was used in training, potentially exposing sensitive personal information.",
            "actor": "Malicious third party",
            "vulnerable_group": None,
            "likelihood": "unlikely",
            "consequence": "Privacy violation and potential GDPR breach affecting individuals whose data was used without their knowledge.",
        },
        {
            "description": "An overzealous operator expands the data collected for the system beyond what is strictly necessary, processing additional personal data fields without a documented lawful basis.",
            "actor": "Overzealous operator",
            "vulnerable_group": None,
            "likelihood": "likely",
            "consequence": "GDPR violation under the data minimisation principle, with potential regulatory fines and reputational damage.",
        },
    ],
    "human_oversight": [
        {
            "description": "Under high workload conditions, human reviewers rubber-stamp model outputs without exercising independent judgement, effectively removing meaningful human oversight.",
            "actor": "Overwhelmed operator",
            "vulnerable_group": None,
            "likelihood": "likely",
            "consequence": "Loss of meaningful human oversight, converting a human-in-the-loop system into a de facto automated decision system without the required safeguards.",
        },
    ],
    "transparency": [
        {
            "description": "A deployer disables or suppresses explanation outputs to reduce system latency, removing the operator's ability to understand or contest individual decisions.",
            "actor": "Cost-cutting deployer",
            "vulnerable_group": None,
            "likelihood": "possible",
            "consequence": "Violation of Art. 13 transparency requirements and removal of the basis for meaningful human oversight and appeal.",
        },
    ],
    "governance": [
        {
            "description": "A customer of the original deployer uses the system for a purpose not covered by its validation or risk assessment, without notifying the provider.",
            "actor": "Downstream user",
            "vulnerable_group": None,
            "likelihood": "possible",
            "consequence": "Use of the system outside its validated scope, creating risks not assessed in the original risk management documentation.",
        },
    ],
    "vulnerable_groups": [
        {
            "description": "The system is applied to decisions affecting minors without the additional safeguards required by Art. 9(9), as the deployer has not correctly identified the affected population as including individuals under 18.",
            "actor": "Uninformed deployer",
            "vulnerable_group": "minors",
            "likelihood": "possible",
            "consequence": "Disproportionate harm to minors and breach of the heightened obligations under Art. 9(9) of the EU AI Act.",
        },
    ],
    "reliability": [
        {
            "description": "The model is used in a new market segment without revalidation, and its accuracy on the new population falls below acceptable thresholds without the deployer noticing due to absent monitoring.",
            "actor": "Negligent operator",
            "vulnerable_group": None,
            "likelihood": "possible",
            "consequence": "Systematic inaccurate decisions affecting a population for which the system was not validated.",
        },
    ],
    "data_quality": [
        {
            "description": "A data provider supplies corrupted or manipulated training data, introducing systematic errors that persist in the deployed model.",
            "actor": "Malicious data supplier",
            "vulnerable_group": None,
            "likelihood": "unlikely",
            "consequence": "Backdoored model behaviour that is difficult to detect and produces systematically biased or incorrect outputs for specific inputs.",
        },
    ],
}

_LLM_MISUSE_PROMPT = """You are an EU AI Act risk management expert.
Generate 2-3 misuse scenarios for the following risk in the context of the described AI system.
Respond ONLY with a JSON array. Each object must have: description, actor, vulnerable_group (string or null), likelihood (very_likely/likely/possible/unlikely), consequence.
No extra text, no markdown."""

_LLM_MISUSE_USER = """AI system: {system_name} ({annex_iii_category})
Risk: {risk_title} — {risk_description}
Generate 2-3 realistic misuse scenarios. JSON array only."""


class RiskEvaluator:
    def evaluate(
        self,
        risks: list[Risk],
        metadata: AISystemMetadata,
        use_llm: bool,
        llm_client: LLMClient,
    ) -> list[Risk]:
        enriched = []
        for risk in risks:
            risk = self._flag_vulnerable_groups(risk, metadata)
            risk = self._generate_misuse_scenarios(risk, metadata, use_llm, llm_client)
            risk = self._compute_composite_severity(risk)
            enriched.append(risk)
        return enriched

    def _flag_vulnerable_groups(self, risk: Risk, metadata: AISystemMetadata) -> Risk:
        combined = " ".join([
            risk.description, risk.title, risk.category,
            metadata.deployment_context, metadata.intended_purpose,
            " ".join(metadata.intended_users),
        ]).lower()

        detected: list[str] = list(risk.vulnerable_groups)
        for group, keywords in _VULNERABLE_KEYWORDS.items():
            if group not in detected and any(kw in combined for kw in keywords):
                detected.append(group)

        return risk.model_copy(update={
            "vulnerable_groups": detected,
            "affects_vulnerable_groups": len(detected) > 0,
        })

    def _generate_misuse_scenarios(
        self,
        risk: Risk,
        metadata: AISystemMetadata,
        use_llm: bool,
        llm_client: LLMClient,
    ) -> Risk:
        scenarios: list[MisuseScenario] = []

        # Rule-based: pick templates for this category
        templates = _MISUSE_TEMPLATES.get(risk.category, [])
        for tmpl in templates[:2]:
            scenarios.append(MisuseScenario(
                description=tmpl["description"],
                actor=tmpl["actor"],
                vulnerable_group=tmpl.get("vulnerable_group"),
                likelihood=LikelihoodLevel(tmpl["likelihood"]),
                consequence=tmpl["consequence"],
            ))

        if use_llm:
            try:
                response = llm_client.complete(
                    _LLM_MISUSE_PROMPT,
                    _LLM_MISUSE_USER.format(
                        system_name=metadata.name,
                        annex_iii_category=metadata.annex_iii_category.value,
                        risk_title=risk.title,
                        risk_description=risk.description,
                    ),
                )
                llm_scenarios = self._parse_llm_scenarios(response.content)
                scenarios.extend(llm_scenarios)
            except (LLMDisabledError, LLMUnavailableError, ValueError):
                pass  # Use rule-based scenarios only

        return risk.model_copy(update={"misuse_scenarios": scenarios, "article_9_step": "9(2)(b)"})

    def _parse_llm_scenarios(self, content: str) -> list[MisuseScenario]:
        content = re.sub(r"```(?:json)?\s*", "", content).strip()
        try:
            items = json.loads(content)
            result = []
            for item in items:
                result.append(MisuseScenario(
                    description=item.get("description", ""),
                    actor=item.get("actor", "Unknown"),
                    vulnerable_group=item.get("vulnerable_group"),
                    likelihood=LikelihoodLevel(item.get("likelihood", "possible")),
                    consequence=item.get("consequence", ""),
                ))
            return result
        except (json.JSONDecodeError, ValueError):
            return []

    def _compute_composite_severity(self, risk: Risk) -> Risk:
        final_severity = composite_severity(risk.severity, risk.likelihood)
        return risk.model_copy(update={"severity": final_severity})
