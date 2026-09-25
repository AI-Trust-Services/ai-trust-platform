"""Requirement templates per obligation cluster (keyed by cluster_id).

Source of truth for auto-generated requirements. When an assessment's requirements are
generated, each obligation's `cluster_id` selects the matching requirement templates
from this flat dict, further filtered by the assessment's risk tier *and* the AI
system's `org_role` (provider vs deployer). Requirements define *how* an obligation is
met (see Requirement model).

Two template shapes coexist:

- **EU AI Act High/Limited** (translated from the authoritative AI Act Requirements
  catalogue): one template per Requirement ID, carrying an explicit
  `requirement_ref` (the Requirement ID, e.g. "P-RM-01"), a `role`
  ("provider"/"deployer") and a `risk` token ("High"/"Limited"/"All"). Where the
  source catalogue splits one Requirement ID across several rows, the rows are
  merged into a single requirement and each row's expected evidence is appended to the
  description as an "Expected evidence:" line (there is no separate evidence schema).

- **Retained sets** (NIST, ISO): carry a `slug` (AITP-* source id) from which the
  generator derives `requirement_ref = f"{article_ref}:{slug}"`, plus `risk_category`
  (always "All") and `category`. These sets have no `role` (they apply to any
  org_role).

The generator uses `requirement_ref = t.get("requirement_ref") or f"{article_ref}:{slug}"`
and `risk = t.get("risk") or t["risk_category"]`, so both shapes flow through the
same filter. Hardcoded for the same reason as obligation_templates.py — the
regulations are law, not configuration.
"""
from __future__ import annotations

import re

# Which source risk tokens apply to each assessment tier. A control is generated
# for a tier if its risk/risk_category is "All" or shares any token here. The
# High/Limited tokens without the "-Risk" suffix come from the AI Act Requirements
# catalogue; the "-Risk" variants come from the retained AISEC-* library.
_TIER_RISK_CATEGORIES: dict[str, set[str]] = {
    "prohibited": {"Prohibited"},
    "high": {"High-Risk", "High"},
    "limited": {"Limited-Risk", "Limited"},
    "minimal": set(),  # only "All"-risk controls apply
    "gpai-standard": {"GPAI"},
    "gpai-systemic": {"GPAI", "GPAI-Systemic"},  # systemic is a superset
}


# Per-requirement AI Act article reference, keyed by requirement_ref (= Requirement ID).
# Derived once from the AI Act Requirements catalogue: the "AI Act Article / Legal
# Source" column, recitals dropped, "Article(s)" -> "Art.". Attached to each requirement
# by requirements_for() and aggregated per cluster by cluster_articles(). Retained sets
# (GPAI/NIST/ISO) have no entry here -> their requirements carry no article.
_REQUIREMENT_ARTICLES: dict[str, str] = {
    "P-RM-01": "Art. 9 (1)(2)",
    "P-RM-02": "Art. 9 (2)(a), (b)",
    "P-RM-03": "Art. 9 (2)(c)",
    "P-RM-04": "Art. 9 (2)(d)",
    "P-RM-05": "Art. 9 (6), (7), (8)",
    "P-RM-06": "Art. 72 (2); Art. 9 (2)",
    "P-RM-07": "Art. 11, Annex IV",
    "P-DG-01": "Art. 10 (1)",
    "P-DG-02": "Art. 10 (2) (a)-(e), (h)",
    "P-DG-03": "Art. 10 (2)(f), (g)",
    "P-DG-04": "Art. 10 (3)",
    "P-DG-05": "Art. 10 (3)",
    "P-DG-06": "Art. 10 (3)",
    "P-DG-07": "Art. 10 (3)",
    "P-DG-08": "Art. 10 (4)",
    "P-DG-09": "Art. 10 (5)",
    "P-TD-01": "Art. 11",
    "P-TD-02": "Art. 11",
    "P-TD-03": "Art. 18 (1)(a)",
    "P-TD-04": "Art. 11 (1)",
    "P-TD-05": "Art. 72(3)",
    "P-RK-01": "Art. 12 (1)",
    "P-RK-02": "Art. 12 (2)",
    "P-RK-03": "Art. 19 (1)",
    "P-TR-01": "Art. 13 (1)",
    "P-TR-02": "Art. 13 (2)",
    "P-HO-01": "Art. 14 (3)(a)",
    "P-HO-02": "Art. 14 (3)(b)",
    "P-HO-03": "Art. 14 (4)(a)",
    "P-HO-04": "Art. 14 (4)(b),(c)",
    "P-HO-05": "Art. 14 (4)(d)",
    "P-HO-06": "Art. 14 (4)(e)",
    "P-HO-07": "Art. 14",
    "P-ARC-01": "Art. 15 (1)",
    "P-ARC-02a": "Art. 15 (3)",
    "P-ARC-02b": "Art. 15 (3)",
    "P-ARC-03a": "Art. 15 (4)",
    "P-ARC-03b": "Art. 15 (4)",
    "P-ARC-04": "Art. 15 (4)",
    "P-ARC-05": "Art. 15 (5)",
    "P-QMS-01a": "Art. 17(1)",
    "P-QMS-01b": "Art. 17(1)",
    "P-QMS-01c": "Art. 17(1)",
    "P-CA-01a": "Art. 43",
    "P-CA-01b": "Art. 43",
    "P-CA-01c": "Art. 43",
    "P-CA-02": "Art. 47",
    "P-CE-01": "Art. 48",
    "P-REG-01": "Art. 49 (1)",
    "P-REG-02": "Art. 49 (2)",
    "P-REG-03": "Art. 49 (5)",
    "P-LIM-01": "Art. 50 (1)",
    "P-LIM-02": "Art. 50 (2)",
    "P-CAI-01": "Art. 20(1) and (2)",
    "P-PMM-01": "Art. 72(1)",
    "P-PMM-02": "Art. 72(1)",
    "P-PMM-03": "Art. 72(2)",
    "P-PMM-04": "Art. 72(2)",
    "P-PMM-05": "Art. 72(2)",
    "P-PMM-06": "Art. 72(3)",
    "P-ACC-01": "Art. 16 (l)",
    "P-INC-01": "Art. 73",
    "D-TOM-01": "Art. 26(1)",
    "D-HO-01": "Art. 26(2)",
    "D-ID-01": "Art. 26(4)",
    "D-ID-02": "Art. 26(4)",
    "D-OMI-01a": "Art. 26(5), Art. 72",
    "D-OMI-01b": "Art. 26(5), Art. 72",
    "D-OMI-03": "Art. 26(5)",
    "D-OMI-04": "Art. 26(5)",
    "D-OMI-05": "Art. 26(5)",
    "D-IE-01": "Art. 26(7)",
    "D-FIO-01": "Art. 26",
    "D-RL-01": "Art. 26(6)",
    "D-DPIA-01": "Art. 26(11)",
    "D-FRIA-01": "Art. 27",
    "D-FRIA-02": "Art. 27(3)",
    "D-REG-01": "Art. 49 (3)",
    "D-REG-02": "Art. 49 (5)",
    "D-LIM-01a": "Art. 50 (3)",
    "D-LIM-01b": "Art. 50 (3)",
    "D-LIM-02": "Art. 50 (4) subpara. 1",
    "D-LIM-03": "Art. 50 (4) subpara. 2",
}


# Keyed by obligation cluster_id -> list of requirement templates.
_REQUIREMENT_TEMPLATES: dict[str, list[dict]] = {
    # =====================================================================
    # EU AI Act — Provider, High-Risk
    # =====================================================================
    "P-RM": [
        {"requirement_ref": "P-RM-01", "role": "provider", "risk": "High", "category": "general",
         "title": "Establish and maintain the risk management system",
         "description": "Establish and maintain a risk management system for the AI system, including regular review and updating to maintain its effectiveness and relevance over time.\n\nExpected evidence: function is used — RMS feature is used, another RMS connected via API, or documentation for the RMS provided."},
        {"requirement_ref": "P-RM-02", "role": "provider", "risk": "High", "category": "general",
         "title": "Identify and assess known and foreseeable risks",
         "description": "Identify and assess all known and foreseeable risks arising from the use or potential misuse of the AI system, particularly with regard to impacts on health, safety, and fundamental rights.\n\nExpected evidence: function is used — RMS feature is used or risks provided manually."},
        {"requirement_ref": "P-RM-03", "role": "provider", "risk": "High", "category": "general",
         "title": "Analyse additional risks during operation",
         "description": "Analyse additional risks that may emerge during operation, incorporating insights from market surveillance and automated event logging.\n\nExpected evidence: function is used — confirmation by application owner at regular intervals (after review of event logs and market surveillance data)."},
        {"requirement_ref": "P-RM-04", "role": "provider", "risk": "High", "category": "general",
         "title": "Implement risk mitigation measures",
         "description": "Integrate appropriate risk mitigation measures during the design and development phase to reduce identified hazards to an acceptable residual risk level.\n\nExpected evidence: code — technical evidence / source code or documentation (with additional description of risks and mitigation measures)."},
        {"requirement_ref": "P-RM-05", "role": "provider", "risk": "High", "category": "general",
         "title": "Test the effectiveness of risk controls",
         "description": "Conduct systematic testing to ensure that the implemented risk management measures effectively address the identified risks.\n\nExpected evidence: document — test protocol, effectiveness assessment by risk manager as part of the RMS."},
        {"requirement_ref": "P-RM-06", "role": "provider", "risk": "High", "category": "general",
         "title": "Communicate risk management",
         "description": "Promote continuous information exchange between provider and users regarding risk-related aspects throughout the entire lifecycle of the AI system.\n\nExpected evidence: document — evidence on information exchange."},
        {"requirement_ref": "P-RM-07", "role": "provider", "risk": "High", "category": "general",
         "title": "Document risk management",
         "description": "Ensure comprehensive documentation of the risk management system within the technical documentation and the quality management system, making it traceable and verifiable.\n\nExpected evidence: document — RMS feature provides documentation and is used, or technical documentation & QMS."},
    ],
    "P-DG": [
        {"requirement_ref": "P-DG-01", "role": "provider", "risk": "High", "category": "general",
         "title": "Data governance practices",
         "description": "Implement data governance practices for training, validation and testing datasets that are appropriate to the intended purpose of the high-risk AI system.\n\nExpected evidence: code — datasets and respective documentation."},
        {"requirement_ref": "P-DG-02", "role": "provider", "risk": "High", "category": "general",
         "title": "Data management practices",
         "description": "Implement data management practices for training, validation and testing datasets that are appropriate to the intended purpose of the high-risk AI system.\n\nExpected evidence: code — datasets and respective documentation."},
        {"requirement_ref": "P-DG-03", "role": "provider", "risk": "High", "category": "general",
         "title": "Bias and discrimination",
         "description": "Identify, prevent and mitigate potential biases in the datasets that could affect the health and safety of individuals or lead to discrimination prohibited under Union law.\n\nExpected evidence: function is used / document — bias analysis and bias mitigation measures used."},
        {"requirement_ref": "P-DG-04", "role": "provider", "risk": "High", "category": "general",
         "title": "Relevance of datasets",
         "description": "Ensure that training, validation and testing datasets are relevant in view of the intended purpose of the high-risk AI system.\n\nExpected evidence: document — analysis of dataset & protocol."},
        {"requirement_ref": "P-DG-05", "role": "provider", "risk": "High", "category": "general",
         "title": "Sufficient representativeness of datasets",
         "description": "Ensure that training, validation and testing datasets are sufficiently representative in view of the intended purpose of the high-risk AI system.\n\nExpected evidence: document — analysis of dataset & protocol."},
        {"requirement_ref": "P-DG-06", "role": "provider", "risk": "High", "category": "general",
         "title": "Best possible freedom from errors and completeness",
         "description": "Ensure that training, validation and testing datasets are, to the best extent possible, free of errors and complete in view of the intended purpose of the high-risk AI system.\n\nExpected evidence: document — analysis of dataset & protocol."},
        {"requirement_ref": "P-DG-07", "role": "provider", "risk": "High", "category": "general",
         "title": "Appropriate statistical properties",
         "description": "Ensure that training, validation and testing datasets have the appropriate statistical properties, including, where applicable, in relation to the persons or groups of persons on whom the high-risk AI system is intended to be used.\n\nExpected evidence: document — analysis of dataset & protocol."},
        {"requirement_ref": "P-DG-08", "role": "provider", "risk": "High", "category": "general",
         "title": "Context-specific fitness of data",
         "description": "Ensure that datasets take into account, to the extent required by the intended purpose, the characteristics particular to the specific geographical, contextual, behavioural or functional setting within which the high-risk AI system is intended to be used.\n\nExpected evidence: document — analysis of dataset & protocol."},
        {"requirement_ref": "P-DG-09", "role": "provider", "risk": "High", "category": "general",
         "title": "Processing of special categories of personal data for bias detection and correction",
         "description": "Process special categories of personal data for the purpose of ensuring bias detection and correction only where this is strictly necessary and only subject to the conditions and safeguards laid down in Article 10(5).\n\nExpected evidence: document — analysis of dataset & protocol."},
    ],
    "P-TD": [
        {"requirement_ref": "P-TD-01", "role": "provider", "risk": "High", "category": "general",
         "title": "Prepare technical documentation before placing on the market",
         "description": "Prepare the technical documentation prior to placing the high-risk AI system on the market or putting it into service.\n\nExpected evidence: document — technical documentation."},
        {"requirement_ref": "P-TD-02", "role": "provider", "risk": "High", "category": "general",
         "title": "Maintain technical documentation",
         "description": "Update the documentation throughout the entire lifecycle to reflect all modifications and further developments.\n\nExpected evidence: document — technical documentation."},
        {"requirement_ref": "P-TD-03", "role": "provider", "risk": "High", "category": "general",
         "title": "Retention of technical documentation",
         "description": "Ensure that the technical documentation is retained for at least 10 years after the AI system has been placed on the market or made available.\n\nExpected evidence: function is used / document — retention policy, retention deadline calculator (feature)."},
        {"requirement_ref": "P-TD-04", "role": "provider", "risk": "High", "category": "general",
         "title": "Minimum content of the technical documentation",
         "description": "Ensure that the technical documentation contains at least the elements required under Annex IV (e.g. general system description, relevant technical components, the development process, monitoring and control mechanisms, and the implemented risk management approach).\n\nExpected evidence: function is used / document — automated content check (feature)."},
        {"requirement_ref": "P-TD-05", "role": "provider", "risk": "High", "category": "general",
         "title": "Post-market monitoring plan included in technical documentation",
         "description": "Base the post-market monitoring system on a post-market monitoring plan and include that plan in the technical documentation referred to in Annex IV.\n\nExpected evidence: document — post-market monitoring plan (automated content check could be a feature)."},
    ],
    "P-RK": [
        {"requirement_ref": "P-RK-01", "role": "provider", "risk": "High", "category": "general",
         "title": "Implement logging",
         "description": "Automatic logging must be possible throughout the entire lifecycle of the high-risk AI system.\n\nExpected evidence: code — source code, API where possible, or documentation on the approach with an example."},
        {"requirement_ref": "P-RK-02", "role": "provider", "risk": "High", "category": "general",
         "title": "Use and protect logs appropriately",
         "description": "Ensure that logging supports risk monitoring during use, tracking of substantial modifications, market surveillance, and fulfilment of monitoring obligations by users or operators.\n\nExpected evidence: code — respective source code or documentation."},
        {"requirement_ref": "P-RK-03", "role": "provider", "risk": "High", "category": "general",
         "title": "Retain logs for the required period",
         "description": "Retain logs for a minimum period of six months to the extent such logs are under the provider's control.\n\nExpected evidence: function is used / document — feature or retention policy."},
    ],
    "P-TR": [
        {"requirement_ref": "P-TR-01", "role": "provider", "risk": "High", "category": "general",
         "title": "Transparency and comprehensibility",
         "description": "The high-risk AI system must be designed and developed so that its operation is sufficiently transparent to enable deployers to interpret a system's output and use it appropriately.\n\nExpected evidence: code — code or design documentation."},
        {"requirement_ref": "P-TR-02", "role": "provider", "risk": "High", "category": "general",
         "title": "Provide instructions for use",
         "description": "Provide deployers with instructions for use that include concise, complete, correct and clear information that is relevant, accessible and comprehensible. They must cover at least: the identity and contact details of the provider; the characteristics, capabilities and performance limitations of the system (intended purpose; accuracy, robustness and cybersecurity metrics; foreseeable risks and misuse; explainability; performance for specific persons/groups; input data specifications); predetermined changes; the human oversight measures under Article 14; the computational and hardware resources, expected lifetime and maintenance measures; and the mechanisms enabling deployers to collect, store and interpret logs under Article 12.\n\nExpected evidence: document — instructions for use (automated content check could be a feature)."},
    ],
    "P-HO": [
        {"requirement_ref": "P-HO-01", "role": "provider", "risk": "High", "category": "general",
         "title": "Integrate human oversight safeguards",
         "description": "Identify and build appropriate human oversight measures into the high-risk AI system.\n\nExpected evidence: code — code and/or policy for human oversight coupled with a description of human oversight for the specific AI system."},
        {"requirement_ref": "P-HO-02", "role": "provider", "risk": "High", "category": "general",
         "title": "Define and document oversight measures",
         "description": "Identify and document appropriate human oversight measures that are to be implemented by the deployer.\n\nExpected evidence: code — code and/or policy for human oversight coupled with a description of human oversight for the specific AI system."},
        {"requirement_ref": "P-HO-03", "role": "provider", "risk": "High", "category": "general",
         "title": "Enable effective human supervision",
         "description": "Ensure that the oversight person understands the system, is able to monitor its operation, and can detect anomalies.\n\nExpected evidence: document — proof of education and knowledge of the AI system."},
        {"requirement_ref": "P-HO-04", "role": "provider", "risk": "High", "category": "general",
         "title": "Automation bias",
         "description": "Raise awareness of automation bias and ensure that outputs of the system are interpreted correctly.\n\nExpected evidence: document — proof of education and knowledge of the AI system."},
        {"requirement_ref": "P-HO-05", "role": "provider", "risk": "High", "category": "general",
         "title": "Interruption and override",
         "description": "Empower the oversight person to interrupt or override the system when necessary.\n\nExpected evidence: code / document — design element of product / code."},
        {"requirement_ref": "P-HO-06", "role": "provider", "risk": "High", "category": "general",
         "title": "Stop function",
         "description": "Provide a mechanism for intervention, such as a stop function.\n\nExpected evidence: code / document — design element of product / code."},
        {"requirement_ref": "P-HO-07", "role": "provider", "risk": "High", "category": "general",
         "title": "Effective human control",
         "description": "Ensure that these safeguards cannot be overridden by the AI system itself and are responsive to human input.\n\nExpected evidence: code — information about guardrails / design requirement."},
    ],
    "P-AR": [
        {"requirement_ref": "P-ARC-01", "role": "provider", "risk": "High", "category": "general",
         "title": "Lifecycle",
         "description": "Ensure accuracy, robustness and cybersecurity throughout the lifecycle.\n\nExpected evidence: code / document — design documentation."},
        {"requirement_ref": "P-ARC-02a", "role": "provider", "risk": "High", "category": "general",
         "title": "Accuracy",
         "description": "Ensure appropriate and context-specific accuracy of the AI system throughout its entire lifecycle.\n\nExpected evidence: code — design documentation."},
        {"requirement_ref": "P-ARC-02b", "role": "provider", "risk": "High", "category": "general",
         "title": "Accuracy Communication",
         "description": "Clearly communicate the accuracy of the AI system and relevant performance metrics in the instructions for use.\n\nExpected evidence: document — instructions for use."},
        {"requirement_ref": "P-ARC-03a", "role": "provider", "risk": "High", "category": "general",
         "title": "Robustness of AI system",
         "description": "Implement measures to ensure robustness against errors, faults and inconsistencies, both within the system and its operating environment.\n\nExpected evidence: code / document — design documentation."},
        {"requirement_ref": "P-ARC-03b", "role": "provider", "risk": "High", "category": "general",
         "title": "Robustness of operating environment",
         "description": "Implement measures to ensure robustness against errors, faults and inconsistencies, both within the system and its operating environment.\n\nExpected evidence: code / document — design documentation."},
        {"requirement_ref": "P-ARC-04", "role": "provider", "risk": "High", "category": "general",
         "title": "Feedback loops",
         "description": "Mitigate the risk of possibly biased outputs influencing input for future operations (feedback loops) in systems that continue to learn after deployment.\n\nExpected evidence: code / document — design documentation."},
        {"requirement_ref": "P-ARC-05", "role": "provider", "risk": "High", "category": "general",
         "title": "Cybersecurity",
         "description": "Protect the system against manipulation by unauthorised third parties, and implement targeted cybersecurity measures to defend against AI-specific threats such as data poisoning, adversarial examples, and confidentiality attacks.\n\nExpected evidence: code / document — security documentation / policy."},
    ],
    "P-QMS": [
        {"requirement_ref": "P-QMS-01a", "role": "provider", "risk": "High", "category": "general",
         "title": "QMS - usage",
         "description": "Providers of high-risk AI systems must introduce a quality management system.\n\nExpected evidence: function is used / document — QMS feature, an API to another QMS system, or documentation."},
        {"requirement_ref": "P-QMS-01b", "role": "provider", "risk": "High", "category": "general",
         "title": "QMS - Documentation",
         "description": "Providers of high-risk AI systems must document a quality management system.\n\nExpected evidence: function is used / document — QMS feature, an API to another QMS system, or documentation."},
        {"requirement_ref": "P-QMS-01c", "role": "provider", "risk": "High", "category": "general",
         "title": "QMS - regular update",
         "description": "Providers of high-risk AI systems must regularly update a quality management system.\n\nExpected evidence: function is used / document — QMS feature, an API to another QMS system, or documentation."},
    ],
    "P-CA": [
        {"requirement_ref": "P-CA-01a", "role": "provider", "risk": "High", "category": "general",
         "title": "Conformity Assessment - Before market placement",
         "description": "Carry out the applicable conformity assessment procedure for the high-risk AI system before placing it on the market.\n\nExpected evidence: document — documentation of the conformity assessment."},
        {"requirement_ref": "P-CA-01b", "role": "provider", "risk": "High", "category": "general",
         "title": "Conformity Assessment - before putting into service",
         "description": "Carry out the applicable conformity assessment procedure for the high-risk AI system before putting it into service.\n\nExpected evidence: document — documentation of the conformity assessment."},
        {"requirement_ref": "P-CA-01c", "role": "provider", "risk": "High", "category": "general",
         "title": "Conformity Assessment - after a substantial modification where required",
         "description": "Carry out the applicable conformity assessment procedure for the high-risk AI system, where required, after a substantial modification.\n\nExpected evidence: document — documentation of the conformity assessment; substantial modification documentation."},
        {"requirement_ref": "P-CA-02", "role": "provider", "risk": "High", "category": "general",
         "title": "Issue the EU declaration of conformity",
         "description": "Draw up, keep available, and maintain an up-to-date EU declaration of conformity for each high-risk AI system in accordance with Article 47.\n\nExpected evidence: document — EU declaration of conformity."},
    ],
    "P-CE": [
        {"requirement_ref": "P-CE-01", "role": "provider", "risk": "High", "category": "general",
         "title": "Affix the CE marking",
         "description": "Affix the digital CE marking visibly, legibly, and permanently to the high-risk AI system.\n\nExpected evidence: code — respective code."},
    ],
    "P-REG": [
        {"requirement_ref": "P-REG-01", "role": "provider", "risk": "High", "category": "general",
         "title": "Register Annex III high-risk (non-critical-infrastructure use case)",
         "description": "Register the provider and the high-risk AI system in the EU database referred to in Article 71 before placing on the market or putting into service any high-risk AI system listed in Annex III, except for systems referred to in point 2 of Annex III (critical infrastructure).\n\nExpected evidence: document — documentation / confirmation of registration."},
        {"requirement_ref": "P-REG-02", "role": "provider", "risk": "All", "category": "general",
         "title": "Register Art. 6(3) declassified ('not high-risk')",
         "description": "Register the provider and the AI system in the EU database referred to in Article 71 before placing on the market or putting into service any AI system that the provider has concluded is not high-risk pursuant to Article 6(3).\n\nExpected evidence: document — documentation / confirmation of registration."},
        {"requirement_ref": "P-REG-03", "role": "provider", "risk": "High", "category": "general",
         "title": "Register Annex III No. 2 (critical infrastructure use case)",
         "description": "Register high-risk AI systems referred to in point 2 of Annex III (critical infrastructure) at national level instead of in the EU database.\n\nExpected evidence: document — documentation / confirmation of registration."},
    ],
    "P-CAI": [
        {"requirement_ref": "P-CAI-01", "role": "provider", "risk": "High", "category": "general",
         "title": "Corrective actions and duty of information",
         "description": "Immediately investigate the causes of non-conformity of a high-risk system with the EU AI Act and, in accordance with the applicable conditions, inform the national competent authority where the organization, acting as a provider, is aware that the high-risk AI system poses a risk within the meaning of Article 79(1).\n\nExpected evidence: document — documentation of the implemented process, proof of investigation steps and results, and documentation of the information provided to authorities."},
    ],
    "P-PMM": [
        {"requirement_ref": "P-PMM-01", "role": "provider", "risk": "High", "category": "general",
         "title": "Post-market monitoring system - Establishment",
         "description": "Establish a post-market monitoring system.\n\nExpected evidence: function is used / document — PMM feature is used or documentation of the system."},
        {"requirement_ref": "P-PMM-02", "role": "provider", "risk": "High", "category": "general",
         "title": "Post-market monitoring system - Documentation",
         "description": "Document a post-market monitoring system.\n\nExpected evidence: document — documentation of the system."},
        {"requirement_ref": "P-PMM-03", "role": "provider", "risk": "High", "category": "general",
         "title": "Data Collection Requirements of the PMM - Collection",
         "description": "Actively and systematically collect relevant post-market data on the performance of high-risk AI systems throughout their lifetime in order to assess their continuous compliance with the requirements set out in Chapter III, Section 2, including, where relevant, their interaction with other AI systems.\n\nExpected evidence: function is used / document — PMM feature is used, data uploaded, or a policy regarding data collection is uploaded."},
        {"requirement_ref": "P-PMM-04", "role": "provider", "risk": "High", "category": "general",
         "title": "Data Collection Requirements of the PMM - Documentation",
         "description": "Actively and systematically document relevant post-market data on the performance of high-risk AI systems throughout their lifetime in order to assess their continuous compliance with the requirements set out in Chapter III, Section 2, including, where relevant, their interaction with other AI systems.\n\nExpected evidence: function is used / document — PMM feature is used, data uploaded, or a policy regarding data collection is uploaded."},
        {"requirement_ref": "P-PMM-05", "role": "provider", "risk": "High", "category": "general",
         "title": "Data Collection Requirements of the PMM - Analysis",
         "description": "Actively and systematically analyse relevant post-market data on the performance of high-risk AI systems throughout their lifetime in order to assess their continuous compliance with the requirements set out in Chapter III, Section 2, including, where relevant, their interaction with other AI systems.\n\nExpected evidence: function is used / document — PMM feature is used, data uploaded, or a policy regarding data collection is uploaded."},
        {"requirement_ref": "P-PMM-06", "role": "provider", "risk": "High", "category": "general",
         "title": "Post-market monitoring documentation",
         "description": "Base the post-market monitoring system on a post-market monitoring plan.\n\nExpected evidence: document — post-market monitoring plan."},
    ],
    "P-ACC": [
        {"requirement_ref": "P-ACC-01", "role": "provider", "risk": "High", "category": "general",
         "title": "Accessibility",
         "description": "Ensure that the high-risk AI system complies with accessibility requirements in accordance with Directives (EU) 2016/2102 and (EU) 2019/882.\n\nExpected evidence: code / document — documentation of the respective concepts & design decisions, or respective source code."},
    ],
    "P-INC": [
        {"requirement_ref": "P-INC-01", "role": "provider", "risk": "High", "category": "general",
         "title": "Reporting of serious incidents",
         "description": "Report any serious incident to the market surveillance authorities of the Member States where that incident occurred.\n\nExpected evidence: document — incident report."},
    ],

    # =====================================================================
    # EU AI Act — Provider, Limited-Risk
    # =====================================================================
    "P-LIM": [
        {"requirement_ref": "P-LIM-01", "role": "provider", "risk": "Limited", "category": "general",
         "title": "Direct interaction",
         "description": "Ensure that AI systems intended for direct interaction with natural persons are designed and developed so that the individuals concerned are informed that they are interacting with an AI system, unless this is obvious from the context.\n\nExpected evidence: code / document — design decision documentation / technical documentation."},
        {"requirement_ref": "P-LIM-02", "role": "provider", "risk": "Limited", "category": "general",
         "title": "Generative AI",
         "description": "Ensure that synthetic audio, image, video or text content generated or significantly manipulated by the AI system is machine-readable and clearly identifiable as artificially generated or manipulated, using solutions that are, where technically feasible, effective, interoperable, robust and reliable — unless the system merely assists with standard processing or does not substantially alter the input data or its meaning.\n\nExpected evidence: code — design documentation."},
    ],

    # =====================================================================
    # EU AI Act — Deployer, High-Risk
    # =====================================================================
    "D-TOM": [
        {"requirement_ref": "D-TOM-01", "role": "deployer", "risk": "High", "category": "general",
         "title": "Technical and organisational measures",
         "description": "Deployers of high-risk AI systems must implement appropriate technical and organisational measures to ensure the systems are used strictly in accordance with their instructions for use.\n\nExpected evidence: document — instructions for use + technical and organisational measures."},
    ],
    "D-HO": [
        {"requirement_ref": "D-HO-01", "role": "deployer", "risk": "High", "category": "general",
         "title": "Delegation of human oversight",
         "description": "Assign human oversight to persons who have the necessary competence, training and authority, as well as the necessary support.\n\nExpected evidence: document — documentation of competency, training etc.; documentation of the assignment of human oversight."},
    ],
    "D-ID": [
        {"requirement_ref": "D-ID-01", "role": "deployer", "risk": "High", "category": "general",
         "title": "Input data corresponds to intended purpose",
         "description": "The input data must correspond to the intended purpose.\n\nExpected evidence: document — analysis of dataset & protocol."},
        {"requirement_ref": "D-ID-02", "role": "deployer", "risk": "High", "category": "general",
         "title": "Sufficiently representative input data",
         "description": "The input data must be sufficiently representative.\n\nExpected evidence: document — analysis of dataset & protocol."},
    ],
    "D-OMI": [
        {"requirement_ref": "D-OMI-01a", "role": "deployer", "risk": "High", "category": "general",
         "title": "Operational monitoring - usage",
         "description": "Monitor the operation on the basis of the instructions for use and, where relevant, inform providers in accordance with the provider's post-market monitoring plan.\n\nExpected evidence: function is used / document — feature is used or a corresponding policy to the instructions for use."},
        {"requirement_ref": "D-OMI-01b", "role": "deployer", "risk": "High", "category": "general",
         "title": "Operational monitoring - post market monitoring plan",
         "description": "Monitor the operation on the basis of the instructions for use and, where relevant, inform providers in accordance with the provider's post-market monitoring plan.\n\nExpected evidence: document — post-market monitoring plan."},
        {"requirement_ref": "D-OMI-03", "role": "deployer", "risk": "High", "category": "general",
         "title": "Suspension of use",
         "description": "Suspend the use of the high-risk AI system without undue delay.\n\nExpected evidence: document — process description proving that processes are implemented and designed for immediate suspension."},
        {"requirement_ref": "D-OMI-04", "role": "deployer", "risk": "High", "category": "general",
         "title": "Informing the provider about risks",
         "description": "Inform the provider or distributor, as well as the relevant market surveillance authority, where there is reason to consider that the system, when used in accordance with the instructions, may present a risk within the meaning of Article 79(1).\n\nExpected evidence: document — risk report, documentation of the information provided to the respective parties."},
        {"requirement_ref": "D-OMI-05", "role": "deployer", "risk": "High", "category": "general",
         "title": "Reporting serious incidents",
         "description": "Inform the provider without delay, and subsequently the importer or distributor and the relevant market surveillance authorities, where a serious incident has been identified.\n\nExpected evidence: document — incident report, documentation of the information provided to the respective parties."},
    ],
    "D-IE": [
        {"requirement_ref": "D-IE-01", "role": "deployer", "risk": "High", "category": "general",
         "title": "Duty to inform employees",
         "description": "Employees must be informed about the deployment of the AI system.\n\nExpected evidence: document — documentation of the information provided to employees."},
    ],
    "D-FIO": [
        {"requirement_ref": "D-FIO-01", "role": "deployer", "risk": "High", "category": "general",
         "title": "Further information obligations",
         "description": "If the AI system makes or supports decisions affecting natural persons, those individuals must be informed.\n\nExpected evidence: document — documentation of the information provided to the respective individuals, either documentation of the respective concepts & design decisions or respective source code."},
    ],
    "D-RL": [
        {"requirement_ref": "D-RL-01", "role": "deployer", "risk": "High", "category": "general",
         "title": "Retention of logs",
         "description": "Retain logs automatically generated by the high-risk AI system, to the extent they are under the deployer's control, for an appropriate period and at least six months.\n\nExpected evidence: function is used / document — technical documentation."},
    ],
    "D-DPIA": [
        {"requirement_ref": "D-DPIA-01", "role": "deployer", "risk": "High", "category": "general",
         "title": "Data protection impact assessment",
         "description": "A data protection impact assessment must be carried out.\n\nExpected evidence: document — data protection impact assessment (DPA)."},
    ],
    "D-FRIA": [
        {"requirement_ref": "D-FRIA-01", "role": "deployer", "risk": "High", "category": "general",
         "title": "Fundamental rights impact assessment",
         "description": "A fundamental rights impact assessment must be carried out.\n\nExpected evidence: document — fundamental rights impact assessment (FRIA)."},
        {"requirement_ref": "D-FRIA-02", "role": "deployer", "risk": "High", "category": "general",
         "title": "Report FRIA results to the authority",
         "description": "The results of the fundamental rights impact assessment must be reported to the competent market surveillance authority.\n\nExpected evidence: document — documentation / protocol of reporting."},
    ],
    "D-REG": [
        {"requirement_ref": "D-REG-01", "role": "deployer", "risk": "High", "category": "general",
         "title": "Register Annex III high-risk (non-critical-infrastructure use case)",
         "description": "Where the organization acts as a deployer that is a public authority, a Union institution, body, office or agency, or a person acting on its behalf, register itself, select the system, and register the use of any high-risk AI system listed in Annex III in the EU database referred to in Article 71 before putting it into service or using it, except for systems referred to in point 2 of Annex III (critical infrastructure).\n\nExpected evidence: document — documentation / protocol of registration in the EU database."},
        {"requirement_ref": "D-REG-02", "role": "deployer", "risk": "High", "category": "general",
         "title": "Register Annex III No. 2 (critical infrastructure use case)",
         "description": "Register high-risk AI systems referred to in point 2 of Annex III (critical infrastructure) at national level instead of in the EU database.\n\nExpected evidence: document — documentation / protocol of registration in the national database."},
    ],

    # =====================================================================
    # EU AI Act — Deployer, Limited-Risk
    # =====================================================================
    "D-LIM": [
        {"requirement_ref": "D-LIM-01a", "role": "deployer", "risk": "Limited", "category": "general",
         "title": "Emotion Recognition or Biometric Categorisation System",
         "description": "Inform affected natural persons about the operation of the emotion recognition or biometric categorisation system.\n\nExpected evidence: document — documentation / protocol of the information provided to the respective individuals."},
        {"requirement_ref": "D-LIM-01b", "role": "deployer", "risk": "Limited", "category": "general",
         "title": "Emotion Recognition",
         "description": "Process personal data in accordance with the applicable EU data protection legislation where the organization deploys an emotion recognition or biometric categorisation system.\n\nExpected evidence: document — data protection impact assessment (DPA)."},
        {"requirement_ref": "D-LIM-02", "role": "deployer", "risk": "Limited", "category": "general",
         "title": "Deepfake",
         "description": "Disclose that content constituting a deepfake has been artificially generated or manipulated where the organization deploys an AI system that generates or manipulates image, audio, text or video content.\n\nExpected evidence: document — design or technical documentation with appropriate disclosure of artificial generation."},
        {"requirement_ref": "D-LIM-03", "role": "deployer", "risk": "Limited", "category": "general",
         "title": "Text intended for publication",
         "description": "Disclose that text intended for publication to inform the public on matters of public interest has been artificially generated or manipulated where the organization deploys an AI system that generates or manipulates such text.\n\nExpected evidence: document — design or technical documentation with appropriate disclosure of artificial generation."},
    ],

    # =====================================================================
    # Retained sets (unchanged) — keyed by cluster_id (= article_ref).
    # These carry a `slug` (requirement_ref = "{article_ref}:{slug}") and
    # `risk_category` ("All"); they have no `role`, so they apply to any
    # org_role and any tier. NIST/ISO only — the EU AI Act contributes no
    # retained sets (its obligations/controls come solely from the AI Act
    # Requirements catalogue, which covers only High/Limited risk).
    # =====================================================================

    # --- NIST AI RMF (tier-independent) ----------------------------------
    "GOVERN": [
        {"slug": "AITP-NIST-GOVERN", "category": "general", "risk_category": "All",
         "title": "AI governance structures",
         "description": "Establish policies, processes and accountability structures cultivating a culture of AI risk management."},
    ],
    "MAP": [
        {"slug": "AITP-NIST-MAP", "category": "general", "risk_category": "All",
         "title": "Context and risk categorisation",
         "description": "Establish context to frame risks and categorise the AI system's capabilities and impacts."},
    ],
    "MEASURE": [
        {"slug": "AITP-NIST-MEASURE", "category": "monitoring", "risk_category": "All",
         "title": "Risk measurement tooling",
         "description": "Apply quantitative and qualitative tools to analyse, benchmark and monitor AI risk and impacts."},
    ],
    "MANAGE": [
        {"slug": "AITP-NIST-MANAGE", "category": "general", "risk_category": "All",
         "title": "Risk response prioritisation",
         "description": "Allocate resources to respond to mapped and measured risks on a regular, governance-defined basis."},
    ],
    "MAP 1": [
        {"slug": "AITP-NIST-MAP1", "category": "documentation", "risk_category": "All",
         "title": "System provenance record",
         "description": "Document the AI system's intended purpose, context of use and known limitations."},
    ],
    "MANAGE 4": [
        {"slug": "AITP-NIST-MANAGE4", "category": "incident_response", "risk_category": "All",
         "title": "AI incident response",
         "description": "Document and monitor mechanisms to sustain deployed AI value and respond to incidents."},
    ],

    # --- ISO/IEC 42001 (tier-independent) --------------------------------
    "Clause 4": [
        {"slug": "AITP-ISO-C4", "category": "general", "risk_category": "All",
         "title": "Organisational context analysis",
         "description": "Determine external and internal issues and interested-party needs relevant to the AI management system."},
    ],
    "Clause 5": [
        {"slug": "AITP-ISO-C5", "category": "general", "risk_category": "All",
         "title": "Leadership and AI policy",
         "description": "Top management establishes an AI policy, assigns roles and demonstrates commitment to the AIMS."},
    ],
    "Clause 6": [
        {"slug": "AITP-ISO-C6", "category": "general", "risk_category": "All",
         "title": "Risk and opportunity planning",
         "description": "Plan actions addressing risks and opportunities and set AI management system objectives."},
    ],
    "Clause 8": [
        {"slug": "AITP-ISO-C8", "category": "general", "risk_category": "All",
         "title": "Operational controls",
         "description": "Plan, implement and control the processes needed to meet AI management system requirements."},
    ],
    "Clause 9": [
        {"slug": "AITP-ISO-C9", "category": "monitoring", "risk_category": "All",
         "title": "Performance evaluation",
         "description": "Monitor, measure, analyse and evaluate the AIMS including internal audits and management review."},
    ],
}


def _tier_allows(risk_category: str, tier: str) -> bool:
    """True if a control's risk token(s) apply to the assessment tier.

    "All" applies to every tier. Otherwise the ";"-separated tokens are matched
    against the tokens allowed for the tier (see _TIER_RISK_CATEGORIES). Unknown
    tiers allow only "All" controls.
    """
    tokens = {t.strip() for t in risk_category.split(";")}
    if "All" in tokens:
        return True
    return bool(tokens & _TIER_RISK_CATEGORIES.get(tier, set()))


def _role_allows(role: str | None, org_role: str) -> bool:
    """True if a requirement's role applies to the AI system's org_role.

    Retained sets carry no `role` (None) and apply to any org_role. EU CSV
    templates carry an explicit "provider"/"deployer" role and match only that
    org_role — there is no fallback (importer/distributor match nothing).
    """
    return role is None or role == org_role


def requirements_for(cluster_id: str, tier: str, org_role: str = "provider") -> list[dict]:
    """Return requirement templates for an obligation cluster at a tier + org_role.

    Templates are filtered by risk tier (`risk` or `risk_category`) *and* by
    org_role. Returns an empty list when a cluster has no defined requirements, or
    none survive the tier/role filter — callers treat this as "no requirements to
    generate" for that obligation (and, at the cluster level, as "drop this
    obligation entirely").
    """
    out: list[dict] = []
    for t in _REQUIREMENT_TEMPLATES.get(cluster_id, []):
        risk = t.get("risk") or t["risk_category"]
        if _tier_allows(risk, tier) and _role_allows(t.get("role"), org_role):
            # Shallow copy so the per-requirement article can be attached without
            # mutating the module-level template dict.
            out.append({**t, "article": _REQUIREMENT_ARTICLES.get(t.get("requirement_ref", ""), "")})
    return out


def cluster_articles(cluster_id: str, tier: str, org_role: str = "provider", framework: str = "eu_ai_act") -> str:
    """Aggregate the distinct top-level articles of a cluster's requirements.

    Collects the per-requirement article of every requirement that survives the
    tier/role filter, reduces each to its top-level article number (e.g.
    "Art. 9 (2)(a)" -> "Art. 9"), and returns the distinct set sorted by article
    number, joined with ", " (e.g. "Art. 9, Art. 11, Art. 72"). Empty when no
    requirement carries an article (retained sets) — callers fall back to the cluster's
    own display article.
    """
    tops: set[str] = set()
    for t in requirements_for(cluster_id, tier, org_role):
        article = t.get("article") or ""
        for m in re.finditer(r"Art\.\s*\d+[a-z]?", article):
            tops.add(re.sub(r"\s+", " ", m.group(0)))

    def _num(a: str) -> int:
        m = re.search(r"\d+", a)
        return int(m.group(0)) if m else 0

    suffix = " EU AI Act" if framework == "eu_ai_act" else ""
    return ", ".join(sorted(tops, key=_num)) + suffix if tops else ""

