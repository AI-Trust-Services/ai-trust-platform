"""Obligation templates per (framework, risk tier, org_role).

Source of truth for auto-generated obligations. When an assessment's obligations
are generated, the AI system's stored `tier` (and, for EU High/Limited, its
`org_role`) selects the obligation set; NIST and ISO frameworks apply their full
obligation set regardless of tier/role.

The EU AI Act High and Limited sets are the **obligation clusters** translated
from the authoritative AI Act Requirements catalogue (see control_templates.py for
the per-requirement controls). Each cluster is keyed by a stable `cluster_id`
(e.g. "P-RM", "D-LIM"). A cluster is only emitted for a given (tier, org_role)
when at least one of its controls survives `controls_for(cluster_id, tier,
org_role)` — this is where the risk-tier filter, the role filter and the "Risk =
All" rule all live (a single source of truth, in control_templates.py).

The retained sets (prohibited / GPAI / minimal / NIST / ISO) are unchanged; each
carries `cluster_id = article_ref` so cluster-keyed carry-forward works uniformly.
Hardcoded because the regulations are law, not configuration.
"""
from __future__ import annotations

from app.control_templates import controls_for

# --- EU AI Act: High / Limited obligation clusters ---------------------------
# Display metadata only. article_ref is the primary article shown for the cluster;
# whether a cluster is applicable to a (tier, org_role) is decided by whether its
# controls survive the filter, not by any field here. Titles are the cluster names
# from the "Obligation" column of the AI Act Requirements catalogue verbatim; for
# the clusters the catalogue leaves unnamed, a concise title is derived from the
# cluster's theme.
_EU_CLUSTERS = [
    # ----- Provider -----
    {"cluster_id": "P-RM", "role": "provider", "article_ref": "Art. 9",
     "title": "Risk Management System",
     "description": "Establish, implement, document and maintain a risk management system across the entire lifecycle of the high-risk AI system."},
    {"cluster_id": "P-DG", "role": "provider", "article_ref": "Art. 10",
     "title": "Data and Data Governance",
     "description": "Ensure training, validation and testing datasets meet quality criteria and are subject to appropriate data governance and management practices."},
    {"cluster_id": "P-TD", "role": "provider", "article_ref": "Art. 11",
     "title": "Technical Documentation",
     "description": "Draw up and keep up to date technical documentation demonstrating compliance before the system is placed on the market."},
    {"cluster_id": "P-RK", "role": "provider", "article_ref": "Art. 12",
     "title": "Logging and Log Retention",
     "description": "Technically allow for the automatic recording of events (logs) over the lifetime of the system and retain them for the required period."},
    {"cluster_id": "P-TR", "role": "provider", "article_ref": "Art. 13",
     "title": "Information Sharing between Provider and Deployer",
     "description": "Design the system so its operation is sufficiently transparent to enable deployers to interpret output and use it appropriately, and provide instructions for use."},
    {"cluster_id": "P-HO", "role": "provider", "article_ref": "Art. 14",
     "title": "Human Oversight",
     "description": "Design and develop the system so it can be effectively overseen by natural persons during the period in which it is in use."},
    {"cluster_id": "P-AR", "role": "provider", "article_ref": "Art. 15",
     "title": "Accuracy, Robustness and Cybersecurity",
     "description": "Achieve an appropriate level of accuracy, robustness and cybersecurity, consistent throughout the lifecycle."},
    {"cluster_id": "P-QMS", "role": "provider", "article_ref": "Art. 17",
     "title": "Quality Management System",
     "description": "Introduce, document and regularly update a quality management system for the high-risk AI system."},
    {"cluster_id": "P-CA", "role": "provider", "article_ref": "Art. 43, 47",
     "title": "Conformity Assessment, Declaration of Conformity, CE marking",
     "description": "Undergo the relevant conformity assessment procedure prior to placing the system on the market or putting it into service, and draw up and keep up to date the EU declaration of conformity."},
    {"cluster_id": "P-CE", "role": "provider", "article_ref": "Art. 48",
     "title": "CE-Marking",
     "description": "Affix the CE marking to the high-risk AI system to indicate conformity with the EU AI Act."},
    {"cluster_id": "P-REG", "role": "provider", "article_ref": "Art. 49",
     "title": "Registration in EU Database",
     "description": "Register the provider and the AI system in the EU database before placing it on the market or putting it into service."},
    {"cluster_id": "P-CAI", "role": "provider", "article_ref": "Art. 20",
     "title": "Corrective Actions and Duty of Information",
     "description": "Investigate non-conformity, take corrective actions, and inform the competent authorities where the system poses a risk."},
    {"cluster_id": "P-PMM", "role": "provider", "article_ref": "Art. 72",
     "title": "Post Market Monitoring",
     "description": "Establish and document a post-market monitoring system proportionate to the risks of the AI system."},
    {"cluster_id": "P-ACC", "role": "provider", "article_ref": "Art. 16",
     "title": "Accessibility",
     "description": "Ensure that the high-risk AI system complies with the applicable accessibility requirements."},
    {"cluster_id": "P-INC", "role": "provider", "article_ref": "Art. 73",
     "title": "Reporting of Serious Incidents",
     "description": "Report any serious incident to the relevant market surveillance authorities."},
    {"cluster_id": "P-LIM", "role": "provider", "article_ref": "Art. 50",
     "title": "Transparency Obligations (Provider)",
     "description": "Inform natural persons they are interacting with an AI system and mark AI-generated or manipulated content."},
    # ----- Deployer -----
    {"cluster_id": "D-RM", "role": "deployer", "article_ref": "Art. 26",
     "title": "Optional: Risk Management for Deployers",
     "description": "Carry out risk management activities for the high-risk AI system in accordance with the deployer obligations under Article 26 and the organization's risk framework."},
    {"cluster_id": "D-TOM", "role": "deployer", "article_ref": "Art. 26(1)",
     "title": "Technical and Organisational Measures (Deployers)",
     "description": "Implement appropriate technical and organisational measures to ensure the system is used strictly in accordance with its instructions for use."},
    {"cluster_id": "D-HO", "role": "deployer", "article_ref": "Art. 26(2)",
     "title": "Delegation of Human Oversight",
     "description": "Assign human oversight to persons with the necessary competence, training, authority and support."},
    {"cluster_id": "D-ID", "role": "deployer", "article_ref": "Art. 26(4)",
     "title": "Deployer Obligations regarding Input Data",
     "description": "Ensure the input data is relevant and sufficiently representative in view of the intended purpose of the high-risk AI system."},
    {"cluster_id": "D-OMI", "role": "deployer", "article_ref": "Art. 26(5)",
     "title": "Operational Monitoring (Deployers)",
     "description": "Monitor the operation of the system, suspend use where necessary, and inform the provider and authorities about risks and serious incidents."},
    {"cluster_id": "D-IE", "role": "deployer", "article_ref": "Art. 26(7)",
     "title": "Duty to Inform Employees (Deployers)",
     "description": "Inform employees and their representatives about the deployment of the high-risk AI system."},
    {"cluster_id": "D-FIO", "role": "deployer", "article_ref": "Art. 26",
     "title": "Duty to inform Individuals of Decision-Making (Deployers)",
     "description": "Where the system makes or supports decisions affecting natural persons, inform those individuals."},
    {"cluster_id": "D-RL", "role": "deployer", "article_ref": "Art. 26(6)",
     "title": "Retention of Logs (Deployers)",
     "description": "Retain logs automatically generated by the high-risk AI system, to the extent under the deployer's control, for at least six months."},
    {"cluster_id": "D-DPIA", "role": "deployer", "article_ref": "Art. 26(11)",
     "title": "DPIA (Deployers)",
     "description": "Carry out a data protection impact assessment for the deployment of the high-risk AI system."},
    {"cluster_id": "D-FRIA", "role": "deployer", "article_ref": "Art. 27",
     "title": "FRIA (Deployers)",
     "description": "Carry out a fundamental rights impact assessment and report its results to the competent market surveillance authority."},
    {"cluster_id": "D-REG", "role": "deployer", "article_ref": "Art. 49",
     "title": "Registration in EU Database (Deployer)",
     "description": "Where acting as a public-authority deployer, register the use of the high-risk AI system in the EU database before putting it into service."},
    {"cluster_id": "D-LIM", "role": "deployer", "article_ref": "Art. 50",
     "title": "Transparency Obligations (Deployer)",
     "description": "Inform affected persons about emotion recognition or biometric categorisation, and disclose deepfakes and AI-generated public-interest text."},
]

# Voluntary set for minimal-risk systems (EU AI Act Art. 69 codes of conduct).
# All obligations contribute to the compliance score equally.
_EU_MINIMAL = [
    {"cluster_id": "Art. 69", "title": "Adopt voluntary code of conduct", "article_ref": "Art. 69",
     "description": "Consider adopting a voluntary code of conduct covering the requirements applicable to high-risk systems, on a proportionate basis."},
    {"cluster_id": "Art. 69(a) (voluntary)", "title": "Maintain basic technical documentation", "article_ref": "Art. 69(a) (voluntary)",
     "description": "Voluntarily maintain lightweight documentation describing the system's purpose, data, and intended use."},
    {"cluster_id": "Art. 69(b) (voluntary)", "title": "Establish basic monitoring", "article_ref": "Art. 69(b) (voluntary)",
     "description": "Voluntarily monitor the system in production for performance degradation and unexpected behaviour."},
]

_EU_PROHIBITED = [
    {"cluster_id": "Art. 5", "title": "Cease deployment — prohibited practice", "article_ref": "Art. 5",
     "description": "This system falls under a prohibited AI practice and must not be placed on the market, put into service, or used. Immediate remediation required."},
]

_EU_GPAI = [
    {"cluster_id": "Art. 53", "title": "Maintain GPAI technical documentation", "article_ref": "Art. 53",
     "description": "Draw up and keep up to date technical documentation of the general-purpose AI model, including its training and testing process."},
    {"cluster_id": "Art. 53(1)(d)", "title": "Publish training content summary", "article_ref": "Art. 53(1)(d)",
     "description": "Draw up and make publicly available a sufficiently detailed summary of the content used for training the model."},
    {"cluster_id": "Art. 53(1)(c)", "title": "Establish copyright compliance policy", "article_ref": "Art. 53(1)(c)",
     "description": "Put in place a policy to comply with Union copyright law, including reservations of rights expressed under the DSM Directive."},
]

_EU_GPAI_SYSTEMIC = _EU_GPAI + [
    {"cluster_id": "Art. 55", "title": "Perform model evaluation and adversarial testing", "article_ref": "Art. 55",
     "description": "Perform model evaluation, including adversarial testing, to identify and mitigate systemic risks."},
    {"cluster_id": "Art. 55(1)(c)", "title": "Report serious incidents (GPAI systemic)", "article_ref": "Art. 55(1)(c)",
     "description": "Track, document and report serious incidents and possible corrective measures to the AI Office and national authorities."},
    {"cluster_id": "Art. 55(1)(d)", "title": "Ensure cybersecurity protection", "article_ref": "Art. 55(1)(d)",
     "description": "Ensure an adequate level of cybersecurity protection for the model and its physical infrastructure."},
]

# --- NIST AI RMF (tier-independent) ------------------------------------------

_NIST = [
    {"cluster_id": "GOVERN", "title": "GOVERN: Establish AI governance structures", "article_ref": "GOVERN",
     "description": "Cultivate a culture of risk management; establish policies, processes, and accountability structures for AI."},
    {"cluster_id": "MAP", "title": "MAP: Establish context and categorise risks", "article_ref": "MAP",
     "description": "Establish the context to frame risks related to the AI system and categorise its capabilities and impacts."},
    {"cluster_id": "MEASURE", "title": "MEASURE: Analyse and track AI risks", "article_ref": "MEASURE",
     "description": "Use quantitative and qualitative tools to analyse, assess, benchmark, and monitor AI risk and impacts."},
    {"cluster_id": "MANAGE", "title": "MANAGE: Prioritise and respond to risks", "article_ref": "MANAGE",
     "description": "Allocate resources to map and measured risks on a regular basis and as defined by governance functions."},
    {"cluster_id": "MAP 1", "title": "Document AI system provenance", "article_ref": "MAP 1",
     "description": "Document the AI system's intended purpose, context of use, and known limitations."},
    {"cluster_id": "MANAGE 4", "title": "Establish incident response for AI", "article_ref": "MANAGE 4",
     "description": "Document and monitor mechanisms to sustain the value of deployed AI and respond to incidents."},
]

# --- ISO/IEC 42001 (tier-independent) ----------------------------------------

_ISO = [
    {"cluster_id": "Clause 4", "title": "Understand organisational context (Clause 4)", "article_ref": "Clause 4",
     "description": "Determine external and internal issues relevant to the AI management system and the needs of interested parties."},
    {"cluster_id": "Clause 5", "title": "Demonstrate leadership and commitment (Clause 5)", "article_ref": "Clause 5",
     "description": "Top management shall demonstrate leadership and commitment, establishing an AI policy and assigning roles."},
    {"cluster_id": "Clause 6", "title": "Plan to address risks and opportunities (Clause 6)", "article_ref": "Clause 6",
     "description": "Plan actions to address risks and opportunities and set AI management system objectives."},
    {"cluster_id": "Clause 8", "title": "Establish operational controls (Clause 8)", "article_ref": "Clause 8",
     "description": "Plan, implement and control the processes needed to meet AI management system requirements."},
    {"cluster_id": "Clause 9", "title": "Evaluate performance (Clause 9)", "article_ref": "Clause 9",
     "description": "Monitor, measure, analyse and evaluate the AI management system, including internal audits and management review."},
]


def obligations_for(framework_id: str, tier: str, org_role: str = "provider") -> list[dict]:
    """Return the obligation template list for a framework + risk tier + org_role.

    For the EU AI Act at High/Limited tiers, obligation clusters are emitted only
    when at least one of their controls survives the (tier, org_role) filter — so
    provider systems get the provider set, deployer systems get the deployer set,
    and unsupported roles (importer/distributor) get an empty list. Other EU tiers
    and the NIST/ISO frameworks are role-independent.

    Returns an empty list when no obligations apply. Callers treat an empty result
    as "no obligations to generate".
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
        if tier in ("high", "limited"):
            result: list[dict] = []
            for c in _EU_CLUSTERS:
                if c["role"] != org_role:
                    continue
                if controls_for(c["cluster_id"], tier, org_role):
                    result.append({
                        "cluster_id": c["cluster_id"],
                        "title": c["title"],
                        "article_ref": c["article_ref"],
                        "description": c["description"],
                    })
            return result
        if tier == "minimal":
            return list(_EU_MINIMAL)

    return []
