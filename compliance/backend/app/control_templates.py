"""Control templates per obligation (keyed by article_ref).

Source of truth for auto-generated controls. When an assessment's controls are
generated, each obligation's `article_ref` selects the matching control templates
from this flat dict, further filtered by the assessment's risk tier so a control
scoped to one tier (e.g. a prohibited-practice check) never lands on an obligation
from another tier. Controls define *how* an obligation is met (see Control model).

Keyed by `article_ref` alone: refs do not collide across frameworks today
(EU uses "Art. …", NIST uses "GOVERN"/"MAP…", ISO uses "Clause …"), and controls
attach to obligations, whose cross-cycle identity is already `article_ref`.

Each template carries:
- `slug`  — the source control id (AISEC-*); the generator derives the
            carry-forward key `control_ref = f"{article_ref}:{slug}"`
- `risk_category` — the tier(s) the control applies to, verbatim from the source
            library ("All", "High-Risk", "Prohibited", "GPAI", "GPAI-Systemic",
            or a ";"-separated combination). Used to filter by assessment tier.

EU AI Act control texts are adapted from the EU AI Act blueprint control library
(AISEC-* set), mapped to obligations by base article. NIST/ISO controls mirror
their obligation sets. Hardcoded for the same reason as obligation_templates.py —
the regulations are law, not configuration.
"""
from __future__ import annotations

# Which source risk_category tokens apply to each assessment tier. A control is
# generated for a tier if its risk_category is "All" or shares any token here.
_TIER_RISK_CATEGORIES: dict[str, set[str]] = {
    "prohibited": {"Prohibited"},
    "high": {"High-Risk"},
    "limited": {"Limited-Risk"},
    "minimal": set(),  # only "All" controls (the voluntary Art. 69 set)
    "gpai-standard": {"GPAI"},
    "gpai-systemic": {"GPAI", "GPAI-Systemic"},  # systemic is a superset
}


# Keyed by obligation article_ref -> list of control templates.
# Each template: {slug, title, description, category, risk_category}.
_CONTROL_TEMPLATES: dict[str, list[dict]] = {
    # --- EU AI Act: high-risk --------------------------------------------
    "Art. 9": [
        {"slug": "AISEC-RM-002", "category": "process", "risk_category": "High-Risk",
         "title": "Risk management system",
         "description": "Establish and maintain a continuous risk management system throughout the AI system lifecycle, including identification, estimation, evaluation and mitigation of risks (Art. 9(1))."},
        {"slug": "AISEC-RM-003", "category": "process", "risk_category": "High-Risk",
         "title": "Known and foreseeable risk identification",
         "description": "Identify and document known and reasonably foreseeable risks to health, safety and fundamental rights from intended use and reasonably foreseeable misuse (Art. 9(2)(a))."},
        {"slug": "AISEC-RM-004", "category": "process", "risk_category": "High-Risk",
         "title": "Residual risk evaluation",
         "description": "Evaluate residual risks after mitigation and ensure they are acceptable relative to the intended purpose, documenting risk acceptance criteria (Art. 9(2)(d))."},
        {"slug": "AISEC-RM-005", "category": "process", "risk_category": "High-Risk",
         "title": "Risk mitigation measures",
         "description": "Design and implement technical measures to eliminate or reduce identified risks and provide adequate information to deployers (Art. 9(2)(b);(c))."},
        {"slug": "AISEC-RM-006", "category": "technical", "risk_category": "High-Risk",
         "title": "Testing for risk management",
         "description": "Test against defined metrics and probabilistic thresholds for each identified risk, including adversarial testing suitable for the intended purpose (Art. 9(6);(7))."},
    ],
    "Art. 10": [
        {"slug": "AISEC-DG-001", "category": "governance", "risk_category": "High-Risk",
         "title": "Data governance framework",
         "description": "Establish data governance and management practices covering collection processes, operations and quality criteria for training, validation and testing data (Art. 10(2))."},
        {"slug": "AISEC-DG-002", "category": "data", "risk_category": "High-Risk",
         "title": "Training data quality and relevance",
         "description": "Ensure datasets are relevant, sufficiently representative and as error-free as possible, applying appropriate annotation, labelling and cleaning (Art. 10(3))."},
        {"slug": "AISEC-DG-003", "category": "data", "risk_category": "High-Risk",
         "title": "Bias detection and mitigation",
         "description": "Examine datasets for biases likely to affect health, safety or fundamental rights and implement detection and correction measures (Art. 10(2)(f);(g))."},
        {"slug": "AISEC-DG-004", "category": "data", "risk_category": "High-Risk",
         "title": "Data provenance and lineage",
         "description": "Maintain records of data origin, collection method, processing steps and transformations to enable traceability through the pipeline (Art. 10(2)(b);(c))."},
        {"slug": "AISEC-DG-005", "category": "documentation", "risk_category": "High-Risk",
         "title": "Statistical properties documentation",
         "description": "Document dataset statistical properties: characteristics, coverage, gaps, assumptions and known limitations (Art. 10(2)(e))."},
        {"slug": "AISEC-DG-006", "category": "security", "risk_category": "High-Risk",
         "title": "Personal data processing safeguards",
         "description": "Where personal data is processed, apply technical and organisational safeguards including data minimisation and purpose limitation (Art. 10(5))."},
    ],
    "Art. 11": [
        {"slug": "AISEC-TD-001", "category": "documentation", "risk_category": "High-Risk",
         "title": "Technical documentation — system description",
         "description": "Maintain up-to-date documentation of intended purpose, provider identity, version, dependencies and interaction with other systems (Annex IV §1)."},
        {"slug": "AISEC-TD-002", "category": "documentation", "risk_category": "High-Risk",
         "title": "Technical documentation — design specifications",
         "description": "Document general logic, algorithms, key design and classification choices, optimisation targets and computational requirements (Annex IV §2)."},
        {"slug": "AISEC-TD-003", "category": "documentation", "risk_category": "High-Risk",
         "title": "Technical documentation — monitoring and performance",
         "description": "Document monitoring, functioning and control, including accuracy, robustness, cybersecurity levels and known limitations (Annex IV §3)."},
        {"slug": "AISEC-TD-004", "category": "documentation", "risk_category": "High-Risk",
         "title": "Technical documentation — validation and testing",
         "description": "Document validation and testing procedures, metrics, test logs, dates and results, including adversarial testing methodology (Annex IV §4)."},
        {"slug": "AISEC-TD-005", "category": "documentation", "risk_category": "High-Risk",
         "title": "Technical documentation — changes log",
         "description": "Record all changes made after initial conformity assessment, with rationale and impact assessment (Annex IV §6)."},
    ],
    "Art. 12": [
        {"slug": "AISEC-LG-001", "category": "technical", "risk_category": "High-Risk",
         "title": "Automatic event logging capability",
         "description": "Design the system to automatically record events relevant to identifying risks, substantial modifications and post-market monitoring (Art. 12(1))."},
        {"slug": "AISEC-LG-002", "category": "technical", "risk_category": "High-Risk",
         "title": "Logging — identification of use period",
         "description": "Record the period of each use (start and end) and the reference database used for input data checking (Art. 12(2)(a);(b))."},
        {"slug": "AISEC-LG-003", "category": "technical", "risk_category": "High-Risk",
         "title": "Logging — input data reference",
         "description": "Record the input data for which a search led to a match, including reference database version (Art. 12(2)(c))."},
        {"slug": "AISEC-LG-004", "category": "technical", "risk_category": "High-Risk",
         "title": "Logging — human verification results",
         "description": "Record identification of natural persons involved in verifying results, including who verified and approved (Art. 12(2)(d))."},
    ],
    "Art. 13": [
        {"slug": "AISEC-TR-001", "category": "documentation", "risk_category": "High-Risk",
         "title": "Transparency — instructions for use",
         "description": "Provide concise, complete, clear instructions covering intended purpose, accuracy/robustness/cybersecurity levels, known risks, human oversight, lifetime and maintenance (Art. 13(1);(2))."},
    ],
    "Art. 14": [
        {"slug": "AISEC-HO-001", "category": "process", "risk_category": "High-Risk",
         "title": "Human oversight — design for oversight",
         "description": "Design the system with human-machine interface tools allowing effective oversight by natural persons during use (Art. 14(1);(2))."},
        {"slug": "AISEC-HO-002", "category": "process", "risk_category": "High-Risk",
         "title": "Human oversight — understanding capabilities",
         "description": "Enable overseers to understand capacities and limitations, monitor operation and detect anomalies, dysfunction and unexpected performance (Art. 14(4)(a);(b))."},
        {"slug": "AISEC-HO-003", "category": "process", "risk_category": "High-Risk",
         "title": "Human oversight — override and intervention",
         "description": "Enable overseers to disregard, override or reverse output and to safely interrupt the system via a stop control (Art. 14(4)(d);(e))."},
        {"slug": "AISEC-HO-004", "category": "process", "risk_category": "High-Risk",
         "title": "Human oversight — automation bias awareness",
         "description": "Implement measures countering automation bias so overseers do not over-rely on outputs for high-stakes decisions (Art. 14(4)(b))."},
    ],
    "Art. 15": [
        {"slug": "AISEC-AC-001", "category": "technical", "risk_category": "High-Risk",
         "title": "Accuracy metrics and thresholds",
         "description": "Declare and document accuracy levels and metrics for the system and communicate them in the instructions for use (Art. 15(1); Art. 13(3)(b)(i))."},
        {"slug": "AISEC-AC-002", "category": "technical", "risk_category": "High-Risk",
         "title": "Accuracy testing and validation",
         "description": "Validate accuracy against declared metrics, reporting confidence intervals and disaggregated performance across relevant subgroups (Art. 15(1); Art. 9(6))."},
        {"slug": "AISEC-RB-001", "category": "technical", "risk_category": "High-Risk",
         "title": "Robustness by design",
         "description": "Achieve an appropriate level of robustness with technical redundancy solutions including backup or fail-safe plans (Art. 15(3))."},
        {"slug": "AISEC-RB-002", "category": "technical", "risk_category": "High-Risk",
         "title": "Resilience against errors and faults",
         "description": "Ensure resilience to errors, faults or inconsistencies within the system or environment, implementing graceful degradation (Art. 15(3))."},
        {"slug": "AISEC-RB-003", "category": "technical", "risk_category": "High-Risk",
         "title": "Adversarial robustness testing",
         "description": "Test against adversarial attacks relevant to the system type — evasion, poisoning, extraction and other ATLAS-mapped attacks (Art. 15(4))."},
        {"slug": "AISEC-CS-001", "category": "security", "risk_category": "High-Risk",
         "title": "Cybersecurity measures",
         "description": "Implement measures protecting against unauthorised attempts to alter use, behaviour or performance, or to exploit vulnerabilities (Art. 15(5))."},
        {"slug": "AISEC-CS-002", "category": "security", "risk_category": "High-Risk",
         "title": "Protection against data poisoning",
         "description": "Prevent and detect training data poisoning; monitor data pipeline integrity and validate data sources (Art. 15(5)(a))."},
        {"slug": "AISEC-CS-003", "category": "security", "risk_category": "High-Risk",
         "title": "Protection against adversarial inputs",
         "description": "Detect and mitigate adversarial examples and perturbations, including input validation and sanitisation (Art. 15(5)(b))."},
        {"slug": "AISEC-CS-004", "category": "security", "risk_category": "High-Risk",
         "title": "Protection against model manipulation",
         "description": "Defend against model inversion, membership inference and extraction, applying differential privacy or other measures where appropriate (Art. 15(5)(c))."},
        {"slug": "AISEC-CS-005", "category": "security", "risk_category": "High-Risk",
         "title": "Prompt injection defense",
         "description": "Implement multi-layer defence against direct and indirect prompt injection — input filtering, output validation and context isolation — tested with red-teaming (Art. 15(5); Art. 9(6))."},
        {"slug": "AISEC-CS-006", "category": "security", "risk_category": "High-Risk",
         "title": "Supply chain security",
         "description": "Assess and monitor security of third-party components, libraries, models and data sources; maintain an AI Bill of Materials (Art. 15(5); Art. 9(2)(a))."},
    ],
    "Art. 43": [
        {"slug": "AISEC-CA-001", "category": "process", "risk_category": "High-Risk",
         "title": "Conformity assessment procedure",
         "description": "Complete the applicable conformity assessment procedure (Annex VI internal control or Annex VII with a notified body) before placing on the market (Art. 43)."},
    ],
    "Art. 49": [
        {"slug": "AISEC-CA-004", "category": "process", "risk_category": "High-Risk",
         "title": "EU database registration",
         "description": "Register the high-risk AI system in the EU database before placing it on the market or putting it into service (Art. 49(1))."},
    ],
    "Art. 72": [
        {"slug": "AISEC-PM-001", "category": "monitoring", "risk_category": "High-Risk",
         "title": "Post-market monitoring system",
         "description": "Establish and document a post-market monitoring system collecting and analysing data to evaluate continuous compliance over the system lifetime (Art. 72(1);(2))."},
        {"slug": "AISEC-PM-002", "category": "monitoring", "risk_category": "High-Risk",
         "title": "Performance drift detection",
         "description": "Monitor for performance degradation, data drift, concept drift and distribution shift with defined thresholds and alerting (Art. 72(3)(a);(b))."},
    ],
    "Art. 73": [
        {"slug": "AISEC-PM-003", "category": "process", "risk_category": "High-Risk",
         "title": "Serious incident reporting",
         "description": "Report any serious incident to market surveillance authorities without delay and no later than 15 days (Art. 73(1);(2))."},
    ],

    # --- EU AI Act: limited (Art. 50) ------------------------------------
    "Art. 50(1)": [
        {"slug": "AISEC-TR-002", "category": "transparency", "risk_category": "Limited-Risk; High-Risk",
         "title": "Transparency — AI interaction disclosure",
         "description": "Ensure systems intended to interact with natural persons inform them they are interacting with an AI system (Art. 50(1))."},
    ],
    "Art. 50(2)": [
        {"slug": "AISEC-TR-003", "category": "transparency", "risk_category": "Limited-Risk; High-Risk",
         "title": "Transparency — synthetic content marking",
         "description": "Mark AI-generated synthetic audio, image, video or text in a machine-readable format detectable as AI-generated (Art. 50(2))."},
    ],
    "Art. 50(4)": [
        {"slug": "AISEC-TR-004", "category": "transparency", "risk_category": "Limited-Risk; High-Risk",
         "title": "Transparency — deep fake disclosure",
         "description": "Disclose that image, audio or video content constituting a deep fake has been artificially generated or manipulated (Art. 50(4))."},
    ],

    # --- EU AI Act: minimal (Art. 69 voluntary; no source-library rows) --
    "Art. 69": [
        {"slug": "AITP-VOL-001", "category": "governance", "risk_category": "All",
         "title": "Voluntary code of conduct",
         "description": "Adopt and document a voluntary code of conduct covering proportionate application of high-risk requirements (Art. 69)."},
    ],
    "Art. 69(a) (voluntary)": [
        {"slug": "AITP-VOL-002", "category": "documentation", "risk_category": "All",
         "title": "Lightweight system documentation",
         "description": "Voluntarily maintain lightweight documentation of the system's purpose, data and intended use."},
    ],
    "Art. 69(b) (voluntary)": [
        {"slug": "AITP-VOL-003", "category": "monitoring", "risk_category": "All",
         "title": "Basic production monitoring",
         "description": "Voluntarily monitor the system in production for performance degradation and unexpected behaviour."},
    ],

    # --- EU AI Act: prohibited (Art. 5) ----------------------------------
    "Art. 5": [
        {"slug": "AISEC-PH-001", "category": "governance", "risk_category": "Prohibited",
         "title": "Prohibited practice — social scoring",
         "description": "Do not place on the market, put into service or use AI that evaluates or classifies persons on social behaviour or characteristics leading to detrimental treatment (Art. 5(1)(c))."},
        {"slug": "AISEC-PH-002", "category": "governance", "risk_category": "Prohibited",
         "title": "Prohibited practice — subliminal manipulation",
         "description": "Do not deploy subliminal, manipulative or deceptive techniques that materially distort behaviour causing significant harm (Art. 5(1)(a))."},
        {"slug": "AISEC-PH-003", "category": "governance", "risk_category": "Prohibited",
         "title": "Prohibited practice — exploitation of vulnerabilities",
         "description": "Do not exploit vulnerabilities of specific groups (age, disability, social/economic situation) to materially distort behaviour causing significant harm (Art. 5(1)(b))."},
        {"slug": "AISEC-PH-004", "category": "governance", "risk_category": "Prohibited",
         "title": "Prohibited practice — real-time remote biometric identification",
         "description": "Do not use real-time remote biometric identification in publicly accessible spaces for law enforcement except for the exhaustively listed exceptions (Art. 5(1)(h))."},
        {"slug": "AISEC-PH-005", "category": "governance", "risk_category": "Prohibited",
         "title": "Prohibited practice — predictive policing (individual)",
         "description": "Do not assess the risk of a person committing a criminal offence based solely on profiling or personality traits (Art. 5(1)(d))."},
        {"slug": "AISEC-PH-006", "category": "governance", "risk_category": "Prohibited",
         "title": "Prohibited practice — untargeted facial image scraping",
         "description": "Do not create or expand facial recognition databases through untargeted scraping of facial images from the internet or CCTV (Art. 5(1)(e))."},
        {"slug": "AISEC-PH-007", "category": "governance", "risk_category": "Prohibited",
         "title": "Prohibited practice — emotion inference in workplace/education",
         "description": "Do not infer emotions of natural persons in workplace and education settings, except for medical or safety reasons (Art. 5(1)(f))."},
        {"slug": "AISEC-PH-008", "category": "governance", "risk_category": "Prohibited",
         "title": "Prohibited practice — non-consensual intimate imagery",
         "description": "Do not generate or manipulate sexually explicit imagery of real persons without consent or create CSAM; include reasonable safeguards (Art. 5, AI Omnibus)."},
    ],

    # --- EU AI Act: GPAI (Art. 53) ---------------------------------------
    "Art. 53": [
        {"slug": "AISEC-GP-001", "category": "documentation", "risk_category": "GPAI",
         "title": "GPAI model — technical documentation",
         "description": "Draw up and keep up to date Annex XI technical documentation of the model, including training and testing processes and evaluation results (Art. 53(1)(a))."},
        {"slug": "AISEC-GP-003", "category": "documentation", "risk_category": "GPAI",
         "title": "GPAI model — information to downstream providers",
         "description": "Provide downstream providers with sufficient information and documentation, including capabilities and limitations, to enable their own compliance (Art. 53(1)(b))."},
    ],
    "Art. 53(1)(c)": [
        {"slug": "AISEC-GP-002", "category": "governance", "risk_category": "GPAI",
         "title": "GPAI model — copyright compliance policy",
         "description": "Put in place a policy to comply with Union copyright law (Directive 2019/790) covering rights reservations (Art. 53(1)(c))."},
    ],
    "Art. 53(1)(d)": [
        {"slug": "AISEC-GP-002", "category": "documentation", "risk_category": "GPAI",
         "title": "GPAI model — training content summary",
         "description": "Provide a sufficiently detailed summary of training data content using the AI Office template (Art. 53(1)(d))."},
    ],

    # --- EU AI Act: GPAI systemic (Art. 55) ------------------------------
    "Art. 55": [
        {"slug": "AISEC-GP-004", "category": "technical", "risk_category": "GPAI-Systemic",
         "title": "GPAI systemic — safety and security framework",
         "description": "Maintain a safety and security framework and perform model evaluation including adversarial testing to identify and mitigate systemic risks (Art. 55(1))."},
    ],
    "Art. 55(1)(c)": [
        {"slug": "AISEC-GP-004-INC", "category": "process", "risk_category": "GPAI-Systemic",
         "title": "GPAI systemic — serious incident reporting",
         "description": "Track, document and report serious incidents and possible corrective measures to the AI Office and national authorities (Art. 55(1)(c))."},
    ],
    "Art. 55(1)(d)": [
        {"slug": "AISEC-GP-005", "category": "security", "risk_category": "GPAI-Systemic",
         "title": "GPAI systemic — cybersecurity protection",
         "description": "Ensure adequate cybersecurity for the model and its infrastructure, including protection against weight exfiltration and unauthorised access (Art. 55(1)(d))."},
    ],

    # --- NIST AI RMF (tier-independent) ----------------------------------
    "GOVERN": [
        {"slug": "AITP-NIST-GOVERN", "category": "governance", "risk_category": "All",
         "title": "AI governance structures",
         "description": "Establish policies, processes and accountability structures cultivating a culture of AI risk management."},
    ],
    "MAP": [
        {"slug": "AITP-NIST-MAP", "category": "process", "risk_category": "All",
         "title": "Context and risk categorisation",
         "description": "Establish context to frame risks and categorise the AI system's capabilities and impacts."},
    ],
    "MEASURE": [
        {"slug": "AITP-NIST-MEASURE", "category": "monitoring", "risk_category": "All",
         "title": "Risk measurement tooling",
         "description": "Apply quantitative and qualitative tools to analyse, benchmark and monitor AI risk and impacts."},
    ],
    "MANAGE": [
        {"slug": "AITP-NIST-MANAGE", "category": "process", "risk_category": "All",
         "title": "Risk response prioritisation",
         "description": "Allocate resources to respond to mapped and measured risks on a regular, governance-defined basis."},
    ],
    "MAP 1": [
        {"slug": "AITP-NIST-MAP1", "category": "documentation", "risk_category": "All",
         "title": "System provenance record",
         "description": "Document the AI system's intended purpose, context of use and known limitations."},
    ],
    "MANAGE 4": [
        {"slug": "AITP-NIST-MANAGE4", "category": "process", "risk_category": "All",
         "title": "AI incident response",
         "description": "Document and monitor mechanisms to sustain deployed AI value and respond to incidents."},
    ],

    # --- ISO/IEC 42001 (tier-independent) --------------------------------
    "Clause 4": [
        {"slug": "AITP-ISO-C4", "category": "governance", "risk_category": "All",
         "title": "Organisational context analysis",
         "description": "Determine external and internal issues and interested-party needs relevant to the AI management system."},
    ],
    "Clause 5": [
        {"slug": "AITP-ISO-C5", "category": "governance", "risk_category": "All",
         "title": "Leadership and AI policy",
         "description": "Top management establishes an AI policy, assigns roles and demonstrates commitment to the AIMS."},
    ],
    "Clause 6": [
        {"slug": "AITP-ISO-C6", "category": "process", "risk_category": "All",
         "title": "Risk and opportunity planning",
         "description": "Plan actions addressing risks and opportunities and set AI management system objectives."},
    ],
    "Clause 8": [
        {"slug": "AITP-ISO-C8", "category": "process", "risk_category": "All",
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
    """True if a control's risk_category applies to the assessment tier.

    "All" applies to every tier. Otherwise the control's ";"-separated tokens
    are matched against the tokens allowed for the tier (see _TIER_RISK_CATEGORIES).
    Unknown tiers allow only "All" controls.
    """
    tokens = {t.strip() for t in risk_category.split(";")}
    if "All" in tokens:
        return True
    return bool(tokens & _TIER_RISK_CATEGORIES.get(tier, set()))


def controls_for(article_ref: str, tier: str) -> list[dict]:
    """Return control templates for an obligation's article_ref at a given tier.

    Templates whose risk_category does not apply to `tier` are filtered out, so a
    control scoped to one tier never attaches to an obligation from another. Returns
    an empty list when an article_ref has no defined controls (or none match the
    tier) — callers treat this as "no controls to generate" for that obligation and
    should log the gap.
    """
    return [t for t in _CONTROL_TEMPLATES.get(article_ref, []) if _tier_allows(t["risk_category"], tier)]
