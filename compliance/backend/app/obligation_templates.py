"""Obligation templates per (framework, risk tier, org_role).

Source of truth for auto-generated obligations. When an assessment's obligations
are generated, the AI system's stored `tier` (and, for EU High/Limited, its
`org_role`) selects the obligation set; NIST and ISO frameworks apply their full
obligation set regardless of tier/role.

The EU AI Act High and Limited sets are the **obligation clusters** translated
from the authoritative AI Act Requirements catalogue (see requirement_templates.py for
the per-requirement requirements). Each cluster is keyed by a stable `cluster_id`
(e.g. "P-RM", "D-LIM"). A cluster is only emitted for a given (tier, org_role)
when at least one of its requirements survives `requirements_for(cluster_id, tier,
org_role)` — this is where the risk-tier filter, the role filter and the "Risk =
All" rule all live (a single source of truth, in requirement_templates.py).

Hardcoded because the regulations are law, not configuration.
"""
from __future__ import annotations

from app.requirement_templates import requirements_for

# --- EU AI Act: High / Limited obligation clusters ---------------------------
# Display metadata only. article_ref is the primary article shown for the cluster;
# whether a cluster is applicable to a (tier, org_role) is decided by whether its
# controls survive the filter, not by any field here. Titles are the cluster names
# from the "Obligation" column of the AI Act Requirements catalogue verbatim; for
# the clusters the catalogue leaves unnamed, a concise title is derived from the
# cluster's theme. Clusters carry no description of their own — the catalogue
# defines descriptive text only per requirement, so that text lives on the controls
# (see control_templates.py); the obligation is purely a titled grouping.
_EU_CLUSTERS = [
    # ----- Provider -----
    {"cluster_id": "P-RM", "role": "provider", "article_ref": "Art. 9 EU AI Act",
     "title": "Risk Management System (Providers)"},
    {"cluster_id": "P-DG", "role": "provider", "article_ref": "Art. 10 EU AI Act",
     "title": "Data and Data Governance (Providers)"},
    {"cluster_id": "P-TD", "role": "provider", "article_ref": "Art. 11 EU AI Act",
     "title": "Technical Documentation (Providers)"},
    {"cluster_id": "P-RK", "role": "provider", "article_ref": "Art. 12 EU AI Act",
     "title": "Logging and Log Retention (Providers)"},
    {"cluster_id": "P-TR", "role": "provider", "article_ref": "Art. 13 EU AI Act",
     "title": "Information Sharing between Provider and Deployer (Providers)"},
    {"cluster_id": "P-HO", "role": "provider", "article_ref": "Art. 14 EU AI Act",
     "title": "Human Oversight (Providers)"},
    {"cluster_id": "P-AR", "role": "provider", "article_ref": "Art. 15 EU AI Act",
     "title": "Accuracy, Robustness and Cybersecurity (Providers)"},
    {"cluster_id": "P-QMS", "role": "provider", "article_ref": "Art. 17 EU AI Act",
     "title": "Quality Management System (Providers)"},
    {"cluster_id": "P-CA", "role": "provider", "article_ref": "Art. 43, 47 EU AI Act",
     "title": "Conformity Assessment, Declaration of Conformity, CE marking (Providers)"},
    {"cluster_id": "P-CE", "role": "provider", "article_ref": "Art. 48 EU AI Act",
     "title": "CE-Marking (Providers)"},
    {"cluster_id": "P-REG", "role": "provider", "article_ref": "Art. 49 EU AI Act",
     "title": "Registration in EU Database (Providers)"},
    {"cluster_id": "P-CAI", "role": "provider", "article_ref": "Art. 20 EU AI Act",
     "title": "Corrective Actions and Duty of Information (Providers)"},
    {"cluster_id": "P-PMM", "role": "provider", "article_ref": "Art. 72 EU AI Act",
     "title": "Post Market Monitoring (Providers)"},
    {"cluster_id": "P-ACC", "role": "provider", "article_ref": "Art. 16 EU AI Act",
     "title": "Accessibility (Providers)"},
    {"cluster_id": "P-INC", "role": "provider", "article_ref": "Art. 73 EU AI Act",
     "title": "Reporting of Serious Incidents (Providers)"},
    {"cluster_id": "P-LIM", "role": "provider", "article_ref": "Art. 50 EU AI Act",
     "title": "Transparency Obligations (Provider)"},
    # ----- Deployer -----
    {"cluster_id": "D-TOM", "role": "deployer", "article_ref": "Art. 26(1) EU AI Act",
     "title": "Technical and Organisational Measures (Deployers)"},
    {"cluster_id": "D-HO", "role": "deployer", "article_ref": "Art. 26(2) EU AI Act",
     "title": "Delegation of Human Oversight (Deployers)"},
    {"cluster_id": "D-ID", "role": "deployer", "article_ref": "Art. 26(4) EU AI Act",
     "title": "Obligations regarding Input Data (Deployers)"},
    {"cluster_id": "D-OMI", "role": "deployer", "article_ref": "Art. 26(5) EU AI Act",
     "title": "Operational Monitoring (Deployers)"},
    {"cluster_id": "D-IE", "role": "deployer", "article_ref": "Art. 26(7) EU AI Act",
     "title": "Duty to Inform Employees (Deployers)"},
    {"cluster_id": "D-FIO", "role": "deployer", "article_ref": "Art. 26 EU AI Act",
     "title": "Duty to inform Individuals of Decision-Making (Deployers)"},
    {"cluster_id": "D-RL", "role": "deployer", "article_ref": "Art. 26(6) EU AI Act",
     "title": "Retention of Logs (Deployers)"},
    {"cluster_id": "D-DPIA", "role": "deployer", "article_ref": "Art. 26(11) EU AI Act",
     "title": "DPIA (Deployers)"},
    {"cluster_id": "D-FRIA", "role": "deployer", "article_ref": "Art. 27 EU AI Act",
     "title": "FRIA (Deployers)"},
    {"cluster_id": "D-REG", "role": "deployer", "article_ref": "Art. 49 EU AI Act",
     "title": "Registration in EU Database (Deployers)"},
    {"cluster_id": "D-LIM", "role": "deployer", "article_ref": "Art. 50 EU AI Act",
     "title": "Transparency Obligations (Deployers)"},
]

# --- NIST AI RMF (tier-independent) ------------------------------------------

_NIST = [
    {"cluster_id": "GOVERN", "title": "GOVERN: Establish AI governance structures", "article_ref": "GOVERN"},
    {"cluster_id": "MAP", "title": "MAP: Establish context and categorise risks", "article_ref": "MAP"},
    {"cluster_id": "MEASURE", "title": "MEASURE: Analyse and track AI risks", "article_ref": "MEASURE"},
    {"cluster_id": "MANAGE", "title": "MANAGE: Prioritise and respond to risks", "article_ref": "MANAGE"},
    {"cluster_id": "MAP 1", "title": "Document AI system provenance", "article_ref": "MAP 1"},
    {"cluster_id": "MANAGE 4", "title": "Establish incident response for AI", "article_ref": "MANAGE 4"},
]

# --- ISO/IEC 42001 (tier-independent) ----------------------------------------

_ISO = [
    {"cluster_id": "Clause 4", "title": "Understand organisational context (Clause 4)", "article_ref": "Clause 4"},
    {"cluster_id": "Clause 5", "title": "Demonstrate leadership and commitment (Clause 5)", "article_ref": "Clause 5"},
    {"cluster_id": "Clause 6", "title": "Plan to address risks and opportunities (Clause 6)", "article_ref": "Clause 6"},
    {"cluster_id": "Clause 8", "title": "Establish operational controls (Clause 8)", "article_ref": "Clause 8"},
    {"cluster_id": "Clause 9", "title": "Evaluate performance (Clause 9)", "article_ref": "Clause 9"},
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
        if tier in ("high", "limited"):
            result: list[dict] = []
            for c in _EU_CLUSTERS:
                if c["role"] != org_role:
                    continue
                if requirements_for(c["cluster_id"], tier, org_role):
                    result.append({
                        "cluster_id": c["cluster_id"],
                        "title": c["title"],
                        "article_ref": c["article_ref"],
                    })
            return result

    return []
