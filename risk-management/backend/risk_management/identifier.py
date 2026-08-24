from __future__ import annotations

import json
import re
import uuid
from abc import ABC, abstractmethod
from pathlib import Path
from typing import Any

from pydantic import BaseModel

from risk_management.llm_client import LLMClient, LLMDisabledError, LLMUnavailableError
from risk_management.models import (
    AISystemMetadata,
    AnnexIIICategory,
    LikelihoodLevel,
    Risk,
    RiskSource,
    SeverityLevel,
    TaxonomyMapping,
)


class RiskIdentificationResult(BaseModel):
    risks: list[Risk]
    raw_output: dict = {}
    backend_used: str


class RiskIdentifierBackend(ABC):
    """
    The interface contract for all risk identification backends.
    The real IBM Risk Atlas Nexus integration must implement this class.
    See docs/risk-atlas-nexus-integration-kickoff.md for details.
    """

    @abstractmethod
    def identify(
        self,
        system_description: str,
        metadata: AISystemMetadata,
        taxonomy_data: list[dict],
    ) -> RiskIdentificationResult: ...

    @property
    @abstractmethod
    def backend_name(self) -> str: ...


def _make_risk_from_taxonomy(entry: dict, source: RiskSource) -> Risk:
    mappings = [
        TaxonomyMapping(
            taxonomy=m["taxonomy"],
            category=m["category"],
            identifier=m.get("identifier"),
        )
        for m in entry.get("taxonomy_mappings", [])
    ]
    severity = SeverityLevel(entry.get("default_severity", "medium"))
    return Risk(
        id=f"RISK-{uuid.uuid4().hex[:6].upper()}",
        title=entry["title"],
        description=entry["description"],
        category=entry["category"],
        source=source,
        taxonomy_mappings=mappings,
        default_severity=severity,
        severity=severity,
        likelihood=LikelihoodLevel.POSSIBLE,
        affects_vulnerable_groups=entry.get("affects_vulnerable_groups", False),
        vulnerable_groups=list(entry.get("common_vulnerable_groups", [])),
        article_9_step="9(2)(a)",
    )


class StubRiskAtlasNexusBackend(RiskIdentifierBackend):
    """
    Deterministic pre-baked risks by Annex III category.
    Simulates what IBM Risk Atlas Nexus would return without calling the real library.
    Replace with RiskAtlasNexusBackend when ready for real integration.
    """

    # Which taxonomy risk IDs are pre-selected for each Annex III category
    _CATEGORY_RISKS: dict[str, list[str]] = {
        "employment": [
            "TAX-001", "TAX-002", "TAX-003", "TAX-004", "TAX-005",
            "TAX-006", "TAX-012", "TAX-013", "TAX-015", "TAX-019",
        ],
        "essential_services": [
            "TAX-001", "TAX-002", "TAX-003", "TAX-004", "TAX-005",
            "TAX-006", "TAX-007", "TAX-012", "TAX-013", "TAX-017",
        ],
        "education": [
            "TAX-001", "TAX-003", "TAX-005", "TAX-006", "TAX-013",
            "TAX-017", "TAX-022",
        ],
        "law_enforcement": [
            "TAX-001", "TAX-002", "TAX-004", "TAX-005", "TAX-008",
            "TAX-016", "TAX-017", "TAX-019",
        ],
        "biometric": [
            "TAX-001", "TAX-004", "TAX-005", "TAX-008", "TAX-016",
            "TAX-017", "TAX-019",
        ],
        "critical_infrastructure": [
            "TAX-004", "TAX-007", "TAX-008", "TAX-016", "TAX-019", "TAX-025",
        ],
        "justice": [
            "TAX-001", "TAX-003", "TAX-004", "TAX-005", "TAX-009",
            "TAX-017", "TAX-019",
        ],
        "migration": [
            "TAX-001", "TAX-004", "TAX-005", "TAX-017", "TAX-019", "TAX-023",
        ],
        "other": ["TAX-003", "TAX-004", "TAX-010", "TAX-019", "TAX-020"],
    }

    def __init__(self, taxonomy_data: list[dict] | None = None):
        self._taxonomy_data = taxonomy_data or []

    def identify(
        self,
        system_description: str,
        metadata: AISystemMetadata,
        taxonomy_data: list[dict],
    ) -> RiskIdentificationResult:
        category_key = metadata.annex_iii_category.value
        selected_ids = self._CATEGORY_RISKS.get(category_key, self._CATEGORY_RISKS["other"])

        id_to_entry = {e["id"]: e for e in taxonomy_data}
        risks = [
            _make_risk_from_taxonomy(id_to_entry[tid], RiskSource.STUB)
            for tid in selected_ids
            if tid in id_to_entry
        ]
        # Always add governance risks if not already present
        for extra in ["TAX-010", "TAX-020"]:
            if extra in id_to_entry and not any(r.id.startswith("RISK") for r in risks if extra in str(r)):
                existing_titles = {r.title for r in risks}
                entry = id_to_entry[extra]
                if entry["title"] not in existing_titles:
                    risks.append(_make_risk_from_taxonomy(entry, RiskSource.STUB))

        return RiskIdentificationResult(
            risks=risks,
            raw_output={"selected_taxonomy_ids": selected_ids, "category": category_key},
            backend_used=self.backend_name,
        )

    @property
    def backend_name(self) -> str:
        return "stub"


class RuleBasedBackend(RiskIdentifierBackend):
    """
    Keyword and pattern matching against system description and metadata.
    Always available, no network required.
    """

    def identify(
        self,
        system_description: str,
        metadata: AISystemMetadata,
        taxonomy_data: list[dict],
    ) -> RiskIdentificationResult:
        combined_text = " ".join([
            system_description,
            metadata.intended_purpose,
            metadata.deployment_context,
            " ".join(metadata.ai_techniques),
            " ".join(metadata.data_inputs),
            " ".join(metadata.intended_users),
        ]).lower()

        matched_risks: list[Risk] = []
        matched_ids: list[str] = []

        for entry in taxonomy_data:
            # Check Annex III category match
            annex_match = metadata.annex_iii_category.value in entry.get("applicable_annex_iii_categories", [])

            # Check keyword match
            keywords = [kw.lower() for kw in entry.get("keywords", [])]
            keyword_match = any(kw in combined_text for kw in keywords)

            if annex_match or keyword_match:
                matched_risks.append(_make_risk_from_taxonomy(entry, RiskSource.RULE_BASED))
                matched_ids.append(entry["id"])

        return RiskIdentificationResult(
            risks=matched_risks,
            raw_output={"matched_taxonomy_ids": matched_ids},
            backend_used=self.backend_name,
        )

    @property
    def backend_name(self) -> str:
        return "rule_based"


_LLM_SYSTEM_PROMPT = """You are an expert in EU AI Act Article 9 risk management for high-risk AI systems.
Your task is to identify risks for an AI system based on its description and metadata.
You must respond ONLY with a valid JSON array. No explanations, no markdown, no extra text.
Each risk object must have exactly these fields:
- title (string): concise risk title
- description (string): 1-2 sentence description
- category (string): one of: bias, transparency, human_oversight, privacy, data_quality, reliability, security, governance, vulnerable_groups, accessibility
- severity (string): one of: critical, high, medium, low
- likelihood (string): one of: very_likely, likely, possible, unlikely
- taxonomy_ai_act (string): relevant EU AI Act article reference
- taxonomy_nist (string): relevant NIST AI RMF reference or empty string
- affects_vulnerable_groups (boolean)
- vulnerable_groups (array of strings)
"""

_LLM_USER_TEMPLATE = """Identify the key risks for this AI system under EU AI Act Article 9.

System name: {name}
Version: {version}
Annex III category: {annex_iii_category} (point {annex_iii_point})
Intended purpose: {intended_purpose}
Intended users: {intended_users}
Deployment context: {deployment_context}
Data inputs: {data_inputs}
AI techniques: {ai_techniques}

System description:
{system_description}

Return a JSON array of 5-8 risks. JSON only, no other text."""


class LLMAssistedBackend(RiskIdentifierBackend):
    """
    Uses an LLM to identify risks from the system description.
    Falls back to RuleBasedBackend if the LLM is unavailable or returns unparseable output.
    """

    def __init__(self, llm_client: LLMClient):
        self._llm = llm_client
        self._fallback = RuleBasedBackend()

    def identify(
        self,
        system_description: str,
        metadata: AISystemMetadata,
        taxonomy_data: list[dict],
    ) -> RiskIdentificationResult:
        user_prompt = _LLM_USER_TEMPLATE.format(
            name=metadata.name,
            version=metadata.version,
            annex_iii_category=metadata.annex_iii_category.value,
            annex_iii_point=metadata.annex_iii_point,
            intended_purpose=metadata.intended_purpose,
            intended_users=", ".join(metadata.intended_users),
            deployment_context=metadata.deployment_context,
            data_inputs=", ".join(metadata.data_inputs),
            ai_techniques=", ".join(metadata.ai_techniques),
            system_description=system_description[:3000],
        )

        try:
            response = self._llm.complete(_LLM_SYSTEM_PROMPT, user_prompt)
            raw_risks = self._parse_llm_response(response.content)
        except (LLMDisabledError, LLMUnavailableError, ValueError) as exc:
            fallback = self._fallback.identify(system_description, metadata, taxonomy_data)
            fallback.raw_output["llm_error"] = str(exc)
            fallback.raw_output["fallback_used"] = True
            return RiskIdentificationResult(
                risks=fallback.risks,
                raw_output=fallback.raw_output,
                backend_used="llm_assisted (fallback to rule_based)",
            )

        risks = []
        for item in raw_risks:
            severity = SeverityLevel(item.get("severity", "medium"))
            likelihood = LikelihoodLevel(item.get("likelihood", "possible").replace("-", "_"))
            mappings = []
            if item.get("taxonomy_ai_act"):
                mappings.append(TaxonomyMapping(taxonomy="AI_Act", category=item["taxonomy_ai_act"]))
            if item.get("taxonomy_nist"):
                mappings.append(TaxonomyMapping(taxonomy="NIST_AI_RMF", category=item["taxonomy_nist"]))
            risks.append(Risk(
                id=f"RISK-{uuid.uuid4().hex[:6].upper()}",
                title=item.get("title", "Unnamed risk"),
                description=item.get("description", ""),
                category=item.get("category", "governance"),
                source=RiskSource.LLM_ASSISTED,
                taxonomy_mappings=mappings,
                default_severity=severity,
                severity=severity,
                likelihood=likelihood,
                affects_vulnerable_groups=bool(item.get("affects_vulnerable_groups", False)),
                vulnerable_groups=list(item.get("vulnerable_groups", [])),
                article_9_step="9(2)(a)",
            ))

        return RiskIdentificationResult(
            risks=risks,
            raw_output={"llm_model": response.model, "llm_provider": response.provider},
            backend_used=self.backend_name,
        )

    def _parse_llm_response(self, content: str) -> list[dict]:
        # Strip markdown code fences if present
        content = re.sub(r"```(?:json)?\s*", "", content).strip()
        try:
            data = json.loads(content)
            if isinstance(data, list):
                return data
            raise ValueError("Expected a JSON array")
        except json.JSONDecodeError as exc:
            raise ValueError(f"LLM returned invalid JSON: {exc}") from exc

    @property
    def backend_name(self) -> str:
        return "llm_assisted"


class RiskAtlasNexusBackend(RiskIdentifierBackend):
    """
    IBM AI Atlas Nexus integration (ai-atlas-nexus package).
    Uses OllamaInferenceEngine to query the IBM risk taxonomy via LLM.
    Falls back to RuleBasedBackend if the library is not installed or Ollama is unavailable.

    Install with: pip install "ai-atlas-nexus[ollama]"
    Requires Ollama running locally (OLLAMA_BASE_URL env var, default http://localhost:11434).
    """

    _SEVERITY_MAP: dict[str, SeverityLevel] = {
        "critical": SeverityLevel.CRITICAL,
        "very_high": SeverityLevel.CRITICAL,
        "high": SeverityLevel.HIGH,
        "medium": SeverityLevel.MEDIUM,
        "moderate": SeverityLevel.MEDIUM,
        "low": SeverityLevel.LOW,
        "minimal": SeverityLevel.LOW,
    }

    _CATEGORY_MAP: dict[str, str] = {
        "fairness": "bias",
        "bias": "bias",
        "explainability": "transparency",
        "transparency": "transparency",
        "privacy": "privacy",
        "data_protection": "privacy",
        "robustness": "reliability",
        "reliability": "reliability",
        "human_agency": "human_oversight",
        "oversight": "human_oversight",
        "security": "security",
        "adversarial": "security",
        "governance": "governance",
        "accountability": "governance",
    }

    def __init__(self, ollama_base_url: str = "http://localhost:11434", model: str = "llama3.2"):
        self._ollama_base_url = ollama_base_url
        self._model = model
        self._fallback = RuleBasedBackend()

    def identify(
        self,
        system_description: str,
        metadata: AISystemMetadata,
        taxonomy_data: list[dict],
    ) -> RiskIdentificationResult:
        try:
            return self._identify_via_library(system_description, metadata, taxonomy_data)
        except ImportError:
            result = self._fallback.identify(system_description, metadata, taxonomy_data)
            result.raw_output["fallback_reason"] = (
                "ai-atlas-nexus package not installed. "
                'Install with: pip install "ai-atlas-nexus[ollama]"'
            )
            result.raw_output["backend_intended"] = "risk_atlas_nexus"
            return RiskIdentificationResult(
                risks=result.risks,
                raw_output=result.raw_output,
                backend_used="risk_atlas_nexus (fallback to rule_based)",
            )
        except Exception as exc:
            result = self._fallback.identify(system_description, metadata, taxonomy_data)
            result.raw_output["fallback_reason"] = str(exc)
            result.raw_output["backend_intended"] = "risk_atlas_nexus"
            return RiskIdentificationResult(
                risks=result.risks,
                raw_output=result.raw_output,
                backend_used="risk_atlas_nexus (fallback to rule_based)",
            )

    def _identify_via_library(
        self,
        system_description: str,
        metadata: AISystemMetadata,
        taxonomy_data: list[dict],
    ) -> RiskIdentificationResult:
        from ai_atlas_nexus.blocks.inference import OllamaInferenceEngine
        from ai_atlas_nexus.blocks.inference.params import (
            InferenceEngineCredentials,
            OllamaInferenceEngineParams,
        )
        from ai_atlas_nexus.library import AIAtlasNexus

        inference_engine = OllamaInferenceEngine(
            model_name_or_path=self._model,
            credentials=InferenceEngineCredentials(api_url=self._ollama_base_url),
            parameters=OllamaInferenceEngineParams(num_predict=1000, num_ctx=8192, temperature=0),
        )

        usecase = (
            f"System: {metadata.name} v{metadata.version}. "
            f"Purpose: {metadata.intended_purpose}. "
            f"Deployment: {metadata.deployment_context}. "
            f"AI techniques: {', '.join(metadata.ai_techniques)}. "
            f"Data inputs: {', '.join(metadata.data_inputs)}. "
            f"{system_description[:2000]}"
        )

        nexus = AIAtlasNexus()
        raw_risks = nexus.identify_risks_from_usecases(
            usecases=[usecase],
            inference_engine=inference_engine,
            taxonomy="ibm-risk-atlas",
            max_risk=8,
        )

        risks: list[Risk] = []
        atlas_ids: list[str] = []

        for item in (raw_risks or []):
            atlas_id = getattr(item, "id", None) or str(uuid.uuid4())
            atlas_ids.append(atlas_id)

            name = getattr(item, "name", None) or getattr(item, "title", "Unknown risk")
            description = getattr(item, "description", "") or getattr(item, "concern", "")
            risk_type_raw = (getattr(item, "risk_type", "") or "").lower()

            local_category = self._CATEGORY_MAP.get(risk_type_raw, "governance")

            mappings: list[TaxonomyMapping] = [
                TaxonomyMapping(
                    taxonomy="IBM_AI_Atlas",
                    category=risk_type_raw or "general",
                    identifier=atlas_id,
                )
            ]
            related = getattr(item, "related_mappings", None) or []
            for rm in related:
                tax_name = getattr(rm, "taxonomy", None) or str(rm)
                tax_cat = getattr(rm, "category", "") or ""
                tax_id = getattr(rm, "identifier", None)
                if tax_name:
                    mappings.append(TaxonomyMapping(taxonomy=tax_name, category=tax_cat, identifier=tax_id))

            risks.append(Risk(
                id=f"RISK-{uuid.uuid4().hex[:6].upper()}",
                title=name,
                description=description,
                category=local_category,
                source=RiskSource.RISK_ATLAS_NEXUS,
                taxonomy_mappings=mappings,
                default_severity=SeverityLevel.HIGH,
                severity=SeverityLevel.HIGH,
                likelihood=LikelihoodLevel.POSSIBLE,
                affects_vulnerable_groups=local_category in ("bias", "human_oversight"),
                vulnerable_groups=[],
                article_9_step="9(2)(a)",
            ))

        return RiskIdentificationResult(
            risks=risks,
            raw_output={
                "atlas_risk_ids": atlas_ids,
                "taxonomy": "ibm-risk-atlas",
                "model": self._model,
                "usecase_length": len(usecase),
            },
            backend_used=self.backend_name,
        )

    @property
    def backend_name(self) -> str:
        return "risk_atlas_nexus"


def _dedup_risks(risks: list[Risk]) -> list[Risk]:
    """Merge risks with the same category. Keep higher severity, union of taxonomy mappings."""
    seen: dict[str, Risk] = {}
    severity_rank = {
        SeverityLevel.CRITICAL: 4,
        SeverityLevel.HIGH: 3,
        SeverityLevel.MEDIUM: 2,
        SeverityLevel.LOW: 1,
    }
    for risk in risks:
        key = risk.category
        if key not in seen:
            seen[key] = risk
        else:
            existing = seen[key]
            # Keep higher severity
            if severity_rank[risk.severity] > severity_rank[existing.severity]:
                seen[key] = risk.model_copy(update={
                    "taxonomy_mappings": list({
                        (m.taxonomy, m.category): m
                        for m in existing.taxonomy_mappings + risk.taxonomy_mappings
                    }.values()),
                    "vulnerable_groups": list(set(existing.vulnerable_groups + risk.vulnerable_groups)),
                })
            else:
                seen[key] = existing.model_copy(update={
                    "taxonomy_mappings": list({
                        (m.taxonomy, m.category): m
                        for m in existing.taxonomy_mappings + risk.taxonomy_mappings
                    }.values()),
                    "vulnerable_groups": list(set(existing.vulnerable_groups + risk.vulnerable_groups)),
                })
    return list(seen.values())


class RiskIdentifier:
    """
    Orchestrates risk identification backends.
    Rule-based always runs first; LLM results are merged and deduplicated.
    """

    def __init__(self, taxonomy_path: str, llm_client: LLMClient):
        self._taxonomy_data = self._load_taxonomy(taxonomy_path)
        self._llm_client = llm_client

    def _load_taxonomy(self, path: str) -> list[dict]:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)["risks"]

    def identify(
        self,
        system_description: str,
        metadata: AISystemMetadata,
        use_llm: bool = False,
        use_stub: bool = True,
        use_risk_atlas_nexus: bool = False,
    ) -> RiskIdentificationResult:
        if use_risk_atlas_nexus:
            import os
            ollama_base_url = os.environ.get("OLLAMA_BASE_URL", "http://localhost:11434")
            ollama_model = os.environ.get("OLLAMA_MODEL", "llama3.2")
            result = RiskAtlasNexusBackend(
                ollama_base_url=ollama_base_url,
                model=ollama_model,
            ).identify(system_description, metadata, self._taxonomy_data)
        elif use_stub:
            result = StubRiskAtlasNexusBackend().identify(
                system_description, metadata, self._taxonomy_data
            )
        else:
            result = RuleBasedBackend().identify(
                system_description, metadata, self._taxonomy_data
            )

        if use_llm:
            llm_backend = LLMAssistedBackend(self._llm_client)
            llm_result = llm_backend.identify(system_description, metadata, self._taxonomy_data)
            merged = _dedup_risks(result.risks + llm_result.risks)
            return RiskIdentificationResult(
                risks=merged,
                raw_output={**result.raw_output, **llm_result.raw_output, "merged": True},
                backend_used=f"{result.backend_used} + {llm_result.backend_used}",
            )

        return result
