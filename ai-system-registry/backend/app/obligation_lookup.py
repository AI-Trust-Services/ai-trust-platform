"""Minimal EU AI Act obligation lookup for the RCE summary panel.

Returns the applicable obligation titles and article refs for a given EU AI Act tier
and org_role.  Only EU AI Act is supported here — framework-aware full templates live
in compliance/backend.  Data is hardcoded because the EU AI Act is law, not config.

Each entry: {title, article_ref, description, roles}.
roles: "provider" | "deployer" | "both"
"""
from __future__ import annotations

_HIGH = [
    {"title": "Establish a risk management system", "article_ref": "Art. 9",
     "description": "Establish, implement, document and maintain a risk management system.", "roles": "provider"},
    {"title": "Implement data and data governance practices", "article_ref": "Art. 10",
     "description": "Ensure training, validation and testing data sets meet quality criteria.", "roles": "provider"},
    {"title": "Maintain technical documentation", "article_ref": "Art. 11",
     "description": "Draw up and keep up to date technical documentation demonstrating compliance.", "roles": "provider"},
    {"title": "Enable record-keeping and logging", "article_ref": "Art. 12",
     "description": "Technically allow for the automatic recording of events over the lifetime.", "roles": "provider"},
    {"title": "Ensure transparency to deployers", "article_ref": "Art. 13",
     "description": "Design the system so its operation is sufficiently transparent.", "roles": "provider"},
    {"title": "Enable human oversight", "article_ref": "Art. 14",
     "description": "Design and develop the system so it can be effectively overseen by natural persons.", "roles": "provider"},
    {"title": "Ensure accuracy, robustness and cybersecurity", "article_ref": "Art. 15",
     "description": "Achieve an appropriate level of accuracy, robustness and cybersecurity.", "roles": "provider"},
    {"title": "Conduct conformity assessment before market placement", "article_ref": "Art. 43",
     "description": "Undergo the relevant conformity assessment procedure prior to placing on the market.", "roles": "provider"},
    {"title": "Perform post-market monitoring", "article_ref": "Art. 72",
     "description": "Establish and document a post-market monitoring system.", "roles": "provider"},
    {"title": "Use the system in accordance with instructions for use", "article_ref": "Art. 26(1)",
     "description": "Take appropriate measures to use the system in accordance with instructions.", "roles": "deployer"},
    {"title": "Assign and enable human oversight", "article_ref": "Art. 26(5)",
     "description": "Designate a natural person with authority to perform human oversight.", "roles": "deployer"},
    {"title": "Conduct fundamental rights impact assessment", "article_ref": "Art. 27",
     "description": "Carry out a fundamental rights impact assessment before deploying.", "roles": "deployer"},
    {"title": "Suspend or interrupt the system when necessary", "article_ref": "Art. 26(6)",
     "description": "Interrupt or suspend use when a serious incident is identified.", "roles": "deployer"},
    {"title": "Register in the EU AI Act database", "article_ref": "Art. 49",
     "description": "Register the high-risk AI system in the EU database.", "roles": "both"},
    {"title": "Implement serious incident reporting", "article_ref": "Art. 73",
     "description": "Report any serious incident to the relevant market surveillance authorities.", "roles": "both"},
]

_LIMITED = [
    {"title": "Provide transparency about intended purpose", "article_ref": "Art. 50(4)",
     "description": "Provide clear disclosure to affected persons.", "roles": "provider"},
    {"title": "Label synthetic content", "article_ref": "Art. 50(2)",
     "description": "Mark AI-generated content as artificially generated.", "roles": "provider"},
    {"title": "Disclose AI interaction to users", "article_ref": "Art. 50(1)",
     "description": "Inform users that they are interacting with an AI system.", "roles": "both"},
]

_MINIMAL = [
    {"title": "Adopt voluntary code of conduct", "article_ref": "Art. 69",
     "description": "Consider adopting a voluntary code of conduct.", "roles": "both"},
    {"title": "Maintain basic technical documentation", "article_ref": "Art. 69(a) (voluntary)",
     "description": "Voluntarily maintain lightweight documentation.", "roles": "both"},
    {"title": "Establish basic monitoring", "article_ref": "Art. 69(b) (voluntary)",
     "description": "Voluntarily monitor the system in production.", "roles": "both"},
]

_PROHIBITED = [
    {"title": "Cease deployment — prohibited practice", "article_ref": "Art. 5",
     "description": "This system falls under a prohibited AI practice.", "roles": "both"},
]

_GPAI = [
    {"title": "Maintain GPAI technical documentation", "article_ref": "Art. 53",
     "description": "Draw up and keep up to date GPAI model technical documentation.", "roles": "provider"},
    {"title": "Publish training content summary", "article_ref": "Art. 53(1)(d)",
     "description": "Make publicly available a summary of training content.", "roles": "provider"},
    {"title": "Establish copyright compliance policy", "article_ref": "Art. 53(1)(c)",
     "description": "Put in place a policy to comply with Union copyright law.", "roles": "provider"},
]

_GPAI_SYSTEMIC = _GPAI + [
    {"title": "Perform model evaluation and adversarial testing", "article_ref": "Art. 55",
     "description": "Perform model evaluation including adversarial testing.", "roles": "provider"},
    {"title": "Report serious incidents (GPAI systemic)", "article_ref": "Art. 55(1)(c)",
     "description": "Track, document and report serious incidents.", "roles": "provider"},
    {"title": "Ensure cybersecurity protection", "article_ref": "Art. 55(1)(d)",
     "description": "Ensure adequate cybersecurity protection.", "roles": "provider"},
]

_BY_TIER: dict[str, list[dict]] = {
    "high": _HIGH,
    "limited": _LIMITED,
    "minimal": _MINIMAL,
    "prohibited": _PROHIBITED,
    "gpai-standard": _GPAI,
    "gpai-systemic": _GPAI_SYSTEMIC,
}


def obligations_for_tier(tier: str, org_role: str = "provider") -> list[dict]:
    """Return obligations for the given EU AI Act tier filtered by org_role."""
    templates = _BY_TIER.get(tier, [])
    if org_role == "both":
        return list(templates)
    return [o for o in templates if o["roles"] in (org_role, "both")]
