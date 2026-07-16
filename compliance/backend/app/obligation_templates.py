"""Obligation templates per (framework, risk tier).

Source of truth for auto-generated obligations. When an assessment's obligations
are generated, the AI system's stored `tier` selects the EU AI Act obligation
set; NIST and ISO frameworks apply their full obligation set regardless of tier.

Obligation texts are derived from the product spec (EU AI Act §10.6 High Risk
set; §2.4 tier behaviour; Framework Management Ch. 9 for NIST/ISO). These are
hardcoded because the regulations are law, not configuration — mirroring the
approach in the AI System Registry's classifier.
"""
from __future__ import annotations

# --- EU AI Act ---------------------------------------------------------------

_EU_HIGH_RISK = [
    {"title": "Establish a risk management system", "article_ref": "Art. 9",
     "description": "Establish, implement, document and maintain a risk management system across the entire lifecycle of the high-risk AI system."},
    {"title": "Implement data and data governance practices", "article_ref": "Art. 10",
     "description": "Ensure training, validation and testing data sets meet quality criteria and are subject to appropriate data governance and management practices."},
    {"title": "Maintain technical documentation", "article_ref": "Art. 11",
     "description": "Draw up and keep up to date technical documentation demonstrating compliance before the system is placed on the market."},
    {"title": "Enable record-keeping and logging", "article_ref": "Art. 12",
     "description": "Technically allow for the automatic recording of events (logs) over the lifetime of the system."},
    {"title": "Ensure transparency to deployers", "article_ref": "Art. 13",
     "description": "Design the system so its operation is sufficiently transparent to enable deployers to interpret output and use it appropriately."},
    {"title": "Enable human oversight", "article_ref": "Art. 14",
     "description": "Design and develop the system so it can be effectively overseen by natural persons during the period in which it is in use."},
    {"title": "Ensure accuracy, robustness and cybersecurity", "article_ref": "Art. 15",
     "description": "Achieve an appropriate level of accuracy, robustness and cybersecurity, consistent throughout the lifecycle."},
    {"title": "Conduct conformity assessment before market placement", "article_ref": "Art. 43",
     "description": "Undergo the relevant conformity assessment procedure prior to placing the system on the market or putting it into service."},
    {"title": "Register in the EU AI Act database", "article_ref": "Art. 49",
     "description": "Register the high-risk AI system in the EU database before placing it on the market or putting it into service."},
    {"title": "Perform post-market monitoring", "article_ref": "Art. 72",
     "description": "Establish and document a post-market monitoring system proportionate to the risks of the AI system."},
    {"title": "Implement serious incident reporting", "article_ref": "Art. 73",
     "description": "Report any serious incident to the relevant market surveillance authorities."},
]

_EU_LIMITED = [
    {"title": "Disclose AI interaction to users", "article_ref": "Art. 50(1)",
     "description": "Inform natural persons that they are interacting with an AI system, unless this is obvious from the context."},
    {"title": "Label synthetic content", "article_ref": "Art. 50(2)",
     "description": "Mark AI-generated or manipulated audio, image, video or text content as artificially generated in a machine-readable format."},
    {"title": "Provide transparency for the intended purpose", "article_ref": "Art. 50(4)",
     "description": "Provide clear and distinguishable disclosure to affected persons at the time of the first interaction or exposure."},
]

# Voluntary set for minimal-risk systems (EU AI Act Art. 69 codes of conduct).
# All obligations contribute to the compliance score equally.
_EU_MINIMAL = [
    {"title": "Adopt voluntary code of conduct", "article_ref": "Art. 69",
     "description": "Consider adopting a voluntary code of conduct covering the requirements applicable to high-risk systems, on a proportionate basis."},
    {"title": "Maintain basic technical documentation", "article_ref": "Art. 69(a) (voluntary)",
     "description": "Voluntarily maintain lightweight documentation describing the system's purpose, data, and intended use."},
    {"title": "Establish basic monitoring", "article_ref": "Art. 69(b) (voluntary)",
     "description": "Voluntarily monitor the system in production for performance degradation and unexpected behaviour."},
]

_EU_PROHIBITED = [
    {"title": "Cease deployment — prohibited practice", "article_ref": "Art. 5",
     "description": "This system falls under a prohibited AI practice and must not be placed on the market, put into service, or used. Immediate remediation required."},
]

_EU_GPAI = [
    {"title": "Maintain GPAI technical documentation", "article_ref": "Art. 53",
     "description": "Draw up and keep up to date technical documentation of the general-purpose AI model, including its training and testing process."},
    {"title": "Publish training content summary", "article_ref": "Art. 53(1)(d)",
     "description": "Draw up and make publicly available a sufficiently detailed summary of the content used for training the model."},
    {"title": "Establish copyright compliance policy", "article_ref": "Art. 53(1)(c)",
     "description": "Put in place a policy to comply with Union copyright law, including reservations of rights expressed under the DSM Directive."},
]

_EU_GPAI_SYSTEMIC = _EU_GPAI + [
    {"title": "Perform model evaluation and adversarial testing", "article_ref": "Art. 55",
     "description": "Perform model evaluation, including adversarial testing, to identify and mitigate systemic risks."},
    {"title": "Report serious incidents (GPAI systemic)", "article_ref": "Art. 55(1)(c)",
     "description": "Track, document and report serious incidents and possible corrective measures to the AI Office and national authorities."},
    {"title": "Ensure cybersecurity protection", "article_ref": "Art. 55(1)(d)",
     "description": "Ensure an adequate level of cybersecurity protection for the model and its physical infrastructure."},
]

# --- NIST AI RMF (tier-independent) ------------------------------------------

_NIST = [
    {"title": "GOVERN: Establish AI governance structures", "article_ref": "GOVERN",
     "description": "Cultivate a culture of risk management; establish policies, processes, and accountability structures for AI."},
    {"title": "MAP: Establish context and categorise risks", "article_ref": "MAP",
     "description": "Establish the context to frame risks related to the AI system and categorise its capabilities and impacts."},
    {"title": "MEASURE: Analyse and track AI risks", "article_ref": "MEASURE",
     "description": "Use quantitative and qualitative tools to analyse, assess, benchmark, and monitor AI risk and impacts."},
    {"title": "MANAGE: Prioritise and respond to risks", "article_ref": "MANAGE",
     "description": "Allocate resources to map and measured risks on a regular basis and as defined by governance functions."},
    {"title": "Document AI system provenance", "article_ref": "MAP 1",
     "description": "Document the AI system's intended purpose, context of use, and known limitations."},
    {"title": "Establish incident response for AI", "article_ref": "MANAGE 4",
     "description": "Document and monitor mechanisms to sustain the value of deployed AI and respond to incidents."},
]

# --- ISO/IEC 42001 (tier-independent) ----------------------------------------

_ISO = [
    {"title": "Understand organisational context (Clause 4)", "article_ref": "Clause 4",
     "description": "Determine external and internal issues relevant to the AI management system and the needs of interested parties."},
    {"title": "Demonstrate leadership and commitment (Clause 5)", "article_ref": "Clause 5",
     "description": "Top management shall demonstrate leadership and commitment, establishing an AI policy and assigning roles."},
    {"title": "Plan to address risks and opportunities (Clause 6)", "article_ref": "Clause 6",
     "description": "Plan actions to address risks and opportunities and set AI management system objectives."},
    {"title": "Establish operational controls (Clause 8)", "article_ref": "Clause 8",
     "description": "Plan, implement and control the processes needed to meet AI management system requirements."},
    {"title": "Evaluate performance (Clause 9)", "article_ref": "Clause 9",
     "description": "Monitor, measure, analyse and evaluate the AI management system, including internal audits and management review."},
]


def obligations_for(framework_id: str, tier: str) -> list[dict]:
    """Return the obligation template list for a framework + risk tier.

    Returns an empty list only when a framework/tier combination has no defined
    obligations (should not happen for the seeded frameworks). Callers treat an
    empty result as "no obligations to generate".
    """
    if framework_id == "FRM-NIST-AI-RMF":
        return list(_NIST)
    if framework_id == "FRM-ISO-42001":
        return list(_ISO)

    if framework_id == "FRM-EU-AI-ACT":
        if tier == "prohibited":
            return list(_EU_PROHIBITED)
        if tier == "gpai-systemic":
            return list(_EU_GPAI_SYSTEMIC)
        if tier == "gpai-standard":
            return list(_EU_GPAI)
        if tier == "high":
            return list(_EU_HIGH_RISK)
        if tier == "limited":
            return list(_EU_LIMITED)
        if tier == "minimal":
            return list(_EU_MINIMAL)

    return []
