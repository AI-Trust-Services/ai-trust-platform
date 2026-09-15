"""Obligation templates per (framework, risk tier, org_role).

Source of truth for auto-generated obligations. When an assessment's obligations
are generated, the AI system's stored `tier` and `org_role` select the applicable
obligation set.

Obligation texts are derived from the EU AI Act, NIST AI RMF, and ISO/IEC 42001.
These are hardcoded because the regulations are law, not configuration.

Each EU AI Act obligation carries a ``"roles"`` key:
  ``"provider"``  — applies to providers (Art. 3(3)) only
  ``"deployer"``  — applies to deployers (Art. 3(4)) only
  ``"both"``      — applies to both providers and deployers

NIST / ISO obligations are role-agnostic (``"both"``).

The public function ``obligations_for(framework_id, tier, org_role)`` filters by
role. Pass ``org_role="both"`` to receive the full union of provider + deployer
obligations (e.g. when an organisation is simultaneously provider and deployer).
"""
from __future__ import annotations

# --- EU AI Act ---------------------------------------------------------------

_EU_HIGH_RISK = [
    # Provider obligations (Art. 9–15, 43, 72, 73)
    {"title": "Establish a risk management system", "article_ref": "Art. 9",
     "description": "Establish, implement, document and maintain a risk management system across the entire lifecycle of the high-risk AI system.",
     "roles": "provider"},
    {"title": "Implement data and data governance practices", "article_ref": "Art. 10",
     "description": "Ensure training, validation and testing data sets meet quality criteria and are subject to appropriate data governance and management practices.",
     "roles": "provider"},
    {"title": "Maintain technical documentation", "article_ref": "Art. 11",
     "description": "Draw up and keep up to date technical documentation demonstrating compliance before the system is placed on the market.",
     "roles": "provider"},
    {"title": "Enable record-keeping and logging", "article_ref": "Art. 12",
     "description": "Technically allow for the automatic recording of events (logs) over the lifetime of the system.",
     "roles": "provider"},
    {"title": "Ensure transparency to deployers", "article_ref": "Art. 13",
     "description": "Design the system so its operation is sufficiently transparent to enable deployers to interpret output and use it appropriately.",
     "roles": "provider"},
    {"title": "Enable human oversight", "article_ref": "Art. 14",
     "description": "Design and develop the system so it can be effectively overseen by natural persons during the period in which it is in use.",
     "roles": "provider"},
    {"title": "Ensure accuracy, robustness and cybersecurity", "article_ref": "Art. 15",
     "description": "Achieve an appropriate level of accuracy, robustness and cybersecurity, consistent throughout the lifecycle.",
     "roles": "provider"},
    {"title": "Conduct conformity assessment before market placement", "article_ref": "Art. 43",
     "description": "Undergo the relevant conformity assessment procedure prior to placing the system on the market or putting it into service.",
     "roles": "provider"},
    {"title": "Perform post-market monitoring", "article_ref": "Art. 72",
     "description": "Establish and document a post-market monitoring system proportionate to the risks of the AI system.",
     "roles": "provider"},

    # Deployer obligations (Art. 26)
    {"title": "Use the system in accordance with instructions for use", "article_ref": "Art. 26(1)",
     "description": "Take appropriate technical and organisational measures to use the high-risk AI system in accordance with the provider's instructions for use.",
     "roles": "deployer"},
    {"title": "Assign and enable human oversight", "article_ref": "Art. 26(5)",
     "description": "Designate a natural person with authority and competence to perform human oversight of the AI system during use.",
     "roles": "deployer"},
    {"title": "Conduct fundamental rights impact assessment (public bodies)", "article_ref": "Art. 27",
     "description": "For public bodies and regulated private entities: carry out a fundamental rights impact assessment before deploying the high-risk AI system.",
     "roles": "deployer"},
    {"title": "Suspend or interrupt the system when necessary", "article_ref": "Art. 26(6)",
     "description": "Interrupt or suspend use of the system when a serious incident is identified or when the system does not perform as intended.",
     "roles": "deployer"},

    # Obligations shared by both providers and deployers
    {"title": "Register in the EU AI Act database", "article_ref": "Art. 49",
     "description": "Register the high-risk AI system in the EU database before placing it on the market or putting it into service.",
     "roles": "both"},
    {"title": "Implement serious incident reporting", "article_ref": "Art. 73",
     "description": "Report any serious incident to the relevant market surveillance authorities.",
     "roles": "both"},
]

_EU_LIMITED = [
    # Provider obligations
    {"title": "Provide transparency about intended purpose", "article_ref": "Art. 50(4)",
     "description": "Provide clear and distinguishable disclosure to affected persons at the time of the first interaction or exposure.",
     "roles": "provider"},
    {"title": "Label synthetic content", "article_ref": "Art. 50(2)",
     "description": "Mark AI-generated or manipulated audio, image, video or text content as artificially generated in a machine-readable format.",
     "roles": "provider"},

    # Shared obligation — providers must design for disclosure, deployers must operate it
    {"title": "Disclose AI interaction to users", "article_ref": "Art. 50(1)",
     "description": "Inform natural persons that they are interacting with an AI system, unless this is obvious from the context.",
     "roles": "both"},
]

# Voluntary set for minimal-risk systems (EU AI Act Art. 69 codes of conduct).
_EU_MINIMAL = [
    {"title": "Adopt voluntary code of conduct", "article_ref": "Art. 69",
     "description": "Consider adopting a voluntary code of conduct covering the requirements applicable to high-risk systems, on a proportionate basis.",
     "roles": "both"},
    {"title": "Maintain basic technical documentation", "article_ref": "Art. 69(a) (voluntary)",
     "description": "Voluntarily maintain lightweight documentation describing the system's purpose, data, and intended use.",
     "roles": "both"},
    {"title": "Establish basic monitoring", "article_ref": "Art. 69(b) (voluntary)",
     "description": "Voluntarily monitor the system in production for performance degradation and unexpected behaviour.",
     "roles": "both"},
]

_EU_PROHIBITED = [
    {"title": "Cease deployment — prohibited practice", "article_ref": "Art. 5",
     "description": "This system falls under a prohibited AI practice and must not be placed on the market, put into service, or used. Immediate remediation required.",
     "roles": "both"},
]

_EU_GPAI = [
    {"title": "Maintain GPAI technical documentation", "article_ref": "Art. 53",
     "description": "Draw up and keep up to date technical documentation of the general-purpose AI model, including its training and testing process.",
     "roles": "provider"},
    {"title": "Publish training content summary", "article_ref": "Art. 53(1)(d)",
     "description": "Draw up and make publicly available a sufficiently detailed summary of the content used for training the model.",
     "roles": "provider"},
    {"title": "Establish copyright compliance policy", "article_ref": "Art. 53(1)(c)",
     "description": "Put in place a policy to comply with Union copyright law, including reservations of rights expressed under the DSM Directive.",
     "roles": "provider"},
]

_EU_GPAI_SYSTEMIC = _EU_GPAI + [
    {"title": "Perform model evaluation and adversarial testing", "article_ref": "Art. 55",
     "description": "Perform model evaluation, including adversarial testing, to identify and mitigate systemic risks.",
     "roles": "provider"},
    {"title": "Report serious incidents (GPAI systemic)", "article_ref": "Art. 55(1)(c)",
     "description": "Track, document and report serious incidents and possible corrective measures to the AI Office and national authorities.",
     "roles": "provider"},
    {"title": "Ensure cybersecurity protection", "article_ref": "Art. 55(1)(d)",
     "description": "Ensure an adequate level of cybersecurity protection for the model and its physical infrastructure.",
     "roles": "provider"},
]

# --- NIST AI RMF (tier-independent, role-agnostic) ---------------------------

_NIST = [
    {"title": "GOVERN: Establish AI governance structures", "article_ref": "GOVERN",
     "description": "Cultivate a culture of risk management; establish policies, processes, and accountability structures for AI.",
     "roles": "both"},
    {"title": "MAP: Establish context and categorise risks", "article_ref": "MAP",
     "description": "Establish the context to frame risks related to the AI system and categorise its capabilities and impacts.",
     "roles": "both"},
    {"title": "MEASURE: Analyse and track AI risks", "article_ref": "MEASURE",
     "description": "Use quantitative and qualitative tools to analyse, assess, benchmark, and monitor AI risk and impacts.",
     "roles": "both"},
    {"title": "MANAGE: Prioritise and respond to risks", "article_ref": "MANAGE",
     "description": "Allocate resources to map and measured risks on a regular basis and as defined by governance functions.",
     "roles": "both"},
    {"title": "Document AI system provenance", "article_ref": "MAP 1",
     "description": "Document the AI system's intended purpose, context of use, and known limitations.",
     "roles": "both"},
    {"title": "Establish incident response for AI", "article_ref": "MANAGE 4",
     "description": "Document and monitor mechanisms to sustain the value of deployed AI and respond to incidents.",
     "roles": "both"},
]

# --- ISO/IEC 42001 (tier-independent, role-agnostic) -------------------------

_ISO = [
    {"title": "Understand organisational context (Clause 4)", "article_ref": "Clause 4",
     "description": "Determine external and internal issues relevant to the AI management system and the needs of interested parties.",
     "roles": "both"},
    {"title": "Demonstrate leadership and commitment (Clause 5)", "article_ref": "Clause 5",
     "description": "Top management shall demonstrate leadership and commitment, establishing an AI policy and assigning roles.",
     "roles": "both"},
    {"title": "Plan to address risks and opportunities (Clause 6)", "article_ref": "Clause 6",
     "description": "Plan actions to address risks and opportunities and set AI management system objectives.",
     "roles": "both"},
    {"title": "Establish operational controls (Clause 8)", "article_ref": "Clause 8",
     "description": "Plan, implement and control the processes needed to meet AI management system requirements.",
     "roles": "both"},
    {"title": "Evaluate performance (Clause 9)", "article_ref": "Clause 9",
     "description": "Monitor, measure, analyse and evaluate the AI management system, including internal audits and management review.",
     "roles": "both"},
]


def obligations_for(framework_id: str, tier: str, org_role: str = "provider") -> list[dict]:
    """Return the obligation template list for a framework + risk tier + org role.

    ``org_role`` is one of ``"provider"``, ``"deployer"``, or ``"both"``.
    - ``"provider"``  → obligations tagged ``"provider"`` or ``"both"``
    - ``"deployer"``  → obligations tagged ``"deployer"`` or ``"both"``
    - ``"both"``      → all obligations (full union)

    NIST and ISO obligations are all tagged ``"both"`` and are returned regardless
    of ``org_role``. Returns an empty list only when the framework/tier combination
    has no defined obligations.
    """
    if framework_id == "FRM-NIST-AI-RMF":
        return list(_NIST)
    if framework_id == "FRM-ISO-42001":
        return list(_ISO)

    if framework_id == "FRM-EU-AI-ACT":
        if tier == "prohibited":
            templates = list(_EU_PROHIBITED)
        elif tier == "gpai-systemic":
            templates = list(_EU_GPAI_SYSTEMIC)
        elif tier == "gpai-standard":
            templates = list(_EU_GPAI)
        elif tier == "high":
            templates = list(_EU_HIGH_RISK)
        elif tier == "limited":
            templates = list(_EU_LIMITED)
        elif tier == "minimal":
            templates = list(_EU_MINIMAL)
        else:
            return []

        if org_role == "both":
            return templates
        return [o for o in templates if o["roles"] in (org_role, "both")]

    return []
