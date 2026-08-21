from __future__ import annotations

import json
import re
import uuid

from risk_management.llm_client import LLMClient, LLMDisabledError, LLMUnavailableError
from risk_management.models import (
    MitigationHierarchyLevel,
    MitigationMeasure,
    Risk,
)

_HIERARCHY_RANK = {
    MitigationHierarchyLevel.ELIMINATE: 4,
    MitigationHierarchyLevel.REDUCE: 3,
    MitigationHierarchyLevel.MITIGATE: 2,
    MitigationHierarchyLevel.INFORM: 1,
}

_LLM_MITIGATION_SYSTEM = """You are an EU AI Act Article 9 risk management expert.
Given a risk and a list of already-assigned mitigation measures, suggest 1-2 additional mitigations not already covered.
Respond ONLY with a JSON array. Each object: title, description, hierarchy_level (eliminate/reduce/mitigate/inform), implementation_guidance, source (regulation or standard reference).
No extra text, no markdown."""

_LLM_MITIGATION_USER = """Risk: {risk_title}
Category: {risk_category}
Description: {risk_description}

Already assigned mitigations: {existing_titles}

Suggest 1-2 additional mitigations. JSON array only."""


class MitigationAssigner:
    def __init__(self, mitigation_library_path: str):
        with open(mitigation_library_path, "r", encoding="utf-8") as f:
            self._library: list[dict] = json.load(f)["mitigations"]

    def assign(
        self,
        risks: list[Risk],
        use_llm: bool,
        llm_client: LLMClient,
    ) -> list[MitigationMeasure]:
        all_mitigations: list[MitigationMeasure] = []

        for risk in risks:
            if risk.dismissed or not risk.confirmed:
                continue
            measures = self._lookup_from_library(risk)
            if use_llm:
                measures = self._llm_suggest(risk, measures, llm_client)
            # Assign all measures to this risk
            for m in measures:
                if risk.id not in m.assigned_to_risk_ids:
                    m = m.model_copy(update={"assigned_to_risk_ids": m.assigned_to_risk_ids + [risk.id]})
                all_mitigations.append(m)

        # Deduplicate by (id, risk_id) pairs — the same library measure can apply to multiple risks
        return self._dedup_mitigations(all_mitigations)

    def _lookup_from_library(self, risk: Risk) -> list[MitigationMeasure]:
        matches = [
            entry for entry in self._library
            if risk.category in entry.get("applicable_risk_categories", [])
        ]
        # Sort by hierarchy rank descending (eliminate first)
        matches.sort(
            key=lambda e: _HIERARCHY_RANK.get(MitigationHierarchyLevel(e["hierarchy_level"]), 0),
            reverse=True,
        )
        return [
            MitigationMeasure(
                id=entry["id"],
                title=entry["title"],
                description=entry["description"],
                hierarchy_level=MitigationHierarchyLevel(entry["hierarchy_level"]),
                applicable_risk_categories=entry.get("applicable_risk_categories", []),
                implementation_guidance=entry.get("implementation_guidance", ""),
                source=entry.get("source", ""),
                assigned_to_risk_ids=[risk.id],
            )
            for entry in matches
        ]

    def _llm_suggest(
        self,
        risk: Risk,
        existing: list[MitigationMeasure],
        llm_client: LLMClient,
    ) -> list[MitigationMeasure]:
        existing_titles = ", ".join(m.title for m in existing) if existing else "none"
        try:
            response = llm_client.complete(
                _LLM_MITIGATION_SYSTEM,
                _LLM_MITIGATION_USER.format(
                    risk_title=risk.title,
                    risk_category=risk.category,
                    risk_description=risk.description,
                    existing_titles=existing_titles,
                ),
            )
            llm_measures = self._parse_llm_measures(response.content, risk.id)
            return existing + llm_measures
        except (LLMDisabledError, LLMUnavailableError, ValueError):
            return existing

    def _parse_llm_measures(self, content: str, risk_id: str) -> list[MitigationMeasure]:
        content = re.sub(r"```(?:json)?\s*", "", content).strip()
        try:
            items = json.loads(content)
            result = []
            for item in items:
                result.append(MitigationMeasure(
                    id=f"MIT-LLM-{uuid.uuid4().hex[:6].upper()}",
                    title=item.get("title", "LLM-suggested mitigation"),
                    description=item.get("description", ""),
                    hierarchy_level=MitigationHierarchyLevel(item.get("hierarchy_level", "mitigate")),
                    applicable_risk_categories=[],
                    implementation_guidance=item.get("implementation_guidance", ""),
                    source=item.get("source", "LLM suggestion"),
                    assigned_to_risk_ids=[risk_id],
                ))
            return result
        except (json.JSONDecodeError, ValueError):
            return []

    def _dedup_mitigations(self, measures: list[MitigationMeasure]) -> list[MitigationMeasure]:
        # Group by measure ID: merge assigned_to_risk_ids across duplicates
        seen: dict[str, MitigationMeasure] = {}
        for m in measures:
            if m.id not in seen:
                seen[m.id] = m
            else:
                existing = seen[m.id]
                merged_ids = list(set(existing.assigned_to_risk_ids + m.assigned_to_risk_ids))
                seen[m.id] = existing.model_copy(update={"assigned_to_risk_ids": merged_ids})
        return list(seen.values())
