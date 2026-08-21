from __future__ import annotations

from risk_management.models import AISystemMetadata, AnnexIIICategory, RelatedIncident

# Curated set of real AI incidents relevant to Annex III categories.
# Source: AI Incident Database (https://incidentdatabase.ai/)
# These are representative examples — not exhaustive. For live lookup use the AIID API.
_INCIDENTS_BY_CATEGORY: dict[str, list[dict]] = {
    "employment": [
        {
            "incident_id": "AIID-037",
            "title": "Amazon scraps secret AI recruiting tool that showed bias against women",
            "description": "Amazon's ML recruiting tool was trained on CVs submitted to the company over a 10-year period and learned to penalise CVs that included the word 'women's' and downgraded graduates of all-women's colleges.",
            "url": "https://incidentdatabase.ai/cite/37/",
            "relevance_reason": "Direct precedent for recruitment AI gender bias — identical risk category to employment screening systems.",
        },
        {
            "incident_id": "AIID-057",
            "title": "HireVue facial analysis in hiring decisions",
            "description": "HireVue's video interview AI analysed candidates' facial expressions, word choice, and tone of voice to produce a score, raising concerns about bias against disabled applicants and lack of explainability.",
            "url": "https://incidentdatabase.ai/cite/57/",
            "relevance_reason": "Highlights explainability and accessibility risks in AI-assisted hiring.",
        },
    ],
    "essential_services": [
        {
            "incident_id": "AIID-164",
            "title": "Dutch childcare benefits scandal (SyRI algorithm)",
            "description": "The Dutch Tax Authority used an algorithmic risk scoring system that flagged families — disproportionately those with dual nationality — for fraud investigations related to childcare benefits, leading to wrongful debt recovery affecting thousands of families.",
            "url": "https://incidentdatabase.ai/cite/164/",
            "relevance_reason": "Landmark case for algorithmic bias in essential services, proxy discrimination, and lack of human oversight in automated decisions.",
        },
        {
            "incident_id": "AIID-071",
            "title": "UK A-Level grades algorithm downgrades students",
            "description": "An Ofqual algorithm to replace cancelled A-Level exams systematically downgraded students from state schools relative to private schools, using historical school performance as a proxy.",
            "url": "https://incidentdatabase.ai/cite/71/",
            "relevance_reason": "Demonstrates proxy discrimination and distributional shift risk when historical data encodes systemic inequality.",
        },
    ],
    "law_enforcement": [
        {
            "incident_id": "AIID-018",
            "title": "COMPAS recidivism algorithm racial bias",
            "description": "ProPublica analysis found that the COMPAS recidivism risk-scoring tool falsely flagged Black defendants as future criminals at nearly twice the rate as white defendants.",
            "url": "https://incidentdatabase.ai/cite/18/",
            "relevance_reason": "Foundational case for algorithmic bias and racial discrimination in law enforcement AI systems.",
        },
    ],
    "biometric": [
        {
            "incident_id": "AIID-009",
            "title": "Facial recognition misidentification leads to wrongful arrest",
            "description": "A Black man in Detroit was wrongfully arrested after facial recognition software misidentified him as a suspect. The case highlighted accuracy disparities across demographic groups.",
            "url": "https://incidentdatabase.ai/cite/9/",
            "relevance_reason": "Direct precedent for accuracy and bias risks in biometric identification systems, especially for ethnic minorities.",
        },
    ],
    "education": [
        {
            "incident_id": "AIID-071",
            "title": "UK A-Level grades algorithm downgrades students",
            "description": "An Ofqual algorithm to replace cancelled A-Level exams systematically downgraded students from state schools relative to private schools, using historical school performance as a proxy.",
            "url": "https://incidentdatabase.ai/cite/71/",
            "relevance_reason": "Direct precedent for proxy discrimination and distributional shift risk in educational AI systems.",
        },
    ],
    "critical_infrastructure": [
        {
            "incident_id": "AIID-general-infra",
            "title": "AI-driven energy management system causes grid instability",
            "description": "Multiple incidents have been documented where AI-driven demand forecasting and load management systems produced unexpected outputs under novel conditions, requiring emergency human intervention.",
            "url": "https://incidentdatabase.ai/",
            "relevance_reason": "Reliability and distribution shift risk in critical infrastructure AI systems.",
        },
    ],
}

# General incidents relevant to any high-risk AI system
_GENERAL_INCIDENTS = [
    {
        "incident_id": "AIID-general-001",
        "title": "General: over-reliance on AI outputs leads to harmful decisions",
        "description": "Across multiple domains, incidents have been documented where human operators over-relied on AI system outputs without applying independent judgement, causing harm that would have been prevented by adequate oversight.",
        "url": "https://incidentdatabase.ai/",
        "relevance_reason": "Universal risk of automation bias — relevant to any high-risk AI system with human-in-the-loop design.",
    },
    {
        "incident_id": "AIID-general-002",
        "title": "General: model performance degradation after deployment",
        "description": "Numerous AI systems have shown significant performance degradation months after deployment due to distribution shift, without the deploying organisation having monitoring in place to detect the change.",
        "url": "https://incidentdatabase.ai/",
        "relevance_reason": "Universal reliability and post-market monitoring risk — relevant to any high-risk AI system.",
    },
]


class IncidentLookup:
    """
    Looks up real AI incidents from the AI Incident Database relevant to this system.
    Research recommendation: complement the risk catalogue with real-world examples
    for Art. 9(2)(a) 'reasonably foreseeable risks'.

    Currently uses a curated local dataset. Future: live AIID API integration.
    """

    def get_relevant_incidents(
        self,
        metadata: AISystemMetadata,
        max_incidents: int = 4,
    ) -> list[RelatedIncident]:
        category_key = metadata.annex_iii_category.value
        raw = _INCIDENTS_BY_CATEGORY.get(category_key, []) + _GENERAL_INCIDENTS
        seen_ids: set[str] = set()
        results: list[RelatedIncident] = []
        for item in raw:
            if item["incident_id"] not in seen_ids:
                seen_ids.add(item["incident_id"])
                results.append(RelatedIncident(
                    incident_id=item["incident_id"],
                    title=item["title"],
                    description=item["description"],
                    url=item["url"],
                    relevance_reason=item["relevance_reason"],
                ))
            if len(results) >= max_incidents:
                break
        return results
