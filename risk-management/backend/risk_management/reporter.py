from __future__ import annotations

import json
from pathlib import Path

from risk_management.audit_logger import AuditLogger
from risk_management.models import (
    MitigationHierarchyLevel,
    MitigationMeasure,
    Risk,
    RiskRegister,
    SeverityLevel,
)

_SEVERITY_EMOJI = {
    SeverityLevel.CRITICAL: "🔴",
    SeverityLevel.HIGH: "🟠",
    SeverityLevel.MEDIUM: "🟡",
    SeverityLevel.LOW: "🟢",
}

_HIERARCHY_LABEL = {
    MitigationHierarchyLevel.ELIMINATE: "Eliminate (by design)",
    MitigationHierarchyLevel.REDUCE: "Reduce (design change)",
    MitigationHierarchyLevel.MITIGATE: "Mitigate (safeguard)",
    MitigationHierarchyLevel.INFORM: "Inform (training/transparency)",
}


class Reporter:
    def to_json(self, register: RiskRegister) -> str:
        return register.model_dump_json(indent=2)

    def to_markdown(self, register: RiskRegister) -> str:
        sys = register.system
        confirmed_risks = [r for r in register.risks if r.confirmed and not r.dismissed]
        dismissed_risks = [r for r in register.risks if r.dismissed]
        total_risks = len(confirmed_risks)
        critical_count = sum(1 for r in confirmed_risks if r.severity == SeverityLevel.CRITICAL)
        high_count = sum(1 for r in confirmed_risks if r.severity == SeverityLevel.HIGH)

        lines: list[str] = []

        # Title
        lines += [
            f"# AI Risk Register: {sys.name} v{sys.version}",
            f"*Generated: {register.created_at.strftime('%Y-%m-%d %H:%M UTC')}*",
            f"*Register ID: {register.id}*",
            "",
        ]

        # Executive Summary
        lines += [
            "## 1. Executive Summary",
            "",
            f"This risk register documents the Article 9 (EU AI Act) risk assessment for **{sys.name}**, "
            f"an AI system classified under Annex III point **{sys.annex_iii_point}** "
            f"({sys.annex_iii_category.value.replace('_', ' ').title()}).",
            "",
            f"| Metric | Value |",
            f"|--------|-------|",
            f"| Total confirmed risks | {total_risks} |",
            f"| Critical risks | {critical_count} |",
            f"| High risks | {high_count} |",
            f"| Mitigation measures assigned | {len(register.mitigations)} |",
            f"| Review complete | {'Yes' if register.review_complete else 'No (in progress)'} |",
            f"| Residual risk acceptable | {self._fmt_residual(register.residual_risk_acceptable)} |",
            "",
            "> **Scope**: This assessment covers Art. 9(2)(a) risk identification, Art. 9(2)(b) "
            "risk evaluation including misuse scenarios, and Art. 9(2)(d) mitigation assignment. "
            "Post-market monitoring (Art. 9(2)(c)) and formal assurance case (Art. 9(5)) are out of scope for this version.",
            "",
        ]

        # System Under Assessment
        lines += [
            "## 2. System Under Assessment",
            "",
            f"| Field | Value |",
            f"|-------|-------|",
            f"| Name | {sys.name} |",
            f"| Version | {sys.version} |",
            f"| Developer | {sys.developer_org} |",
            f"| Annex III Category | {sys.annex_iii_category.value.replace('_', ' ').title()} (point {sys.annex_iii_point}) |",
            f"| Intended Purpose | {sys.intended_purpose} |",
            f"| Intended Users | {', '.join(sys.intended_users)} |",
            f"| Deployment Context | {sys.deployment_context} |",
            f"| Data Inputs | {', '.join(sys.data_inputs)} |",
            f"| AI Techniques | {', '.join(sys.ai_techniques)} |",
            "",
        ]

        # Risk Identification
        lines += [
            "## 3. Risk Identification (Art. 9(2)(a))",
            "",
            "The following risks were identified through automated analysis and human review.",
            "",
            "| ID | Title | Category | Severity | Likelihood | Taxonomy Mappings | Source |",
            "|----|-------|----------|----------|------------|-------------------|--------|",
        ]
        for risk in confirmed_risks:
            tax = "; ".join(f"{m.taxonomy}: {m.identifier or m.category}" for m in risk.taxonomy_mappings[:3])
            lines.append(
                f"| {risk.id} | {risk.title} | {risk.category} | "
                f"{_SEVERITY_EMOJI.get(risk.severity, '')} {risk.severity.value} | "
                f"{risk.likelihood.value.replace('_', ' ')} | {tax} | {risk.source.value} |"
            )
        lines.append("")

        if dismissed_risks:
            lines += [
                f"*{len(dismissed_risks)} risk(s) were identified but dismissed during human review.*",
                "",
            ]

        # Risk Evaluation
        lines += [
            "## 4. Risk Evaluation (Art. 9(2)(b))",
            "",
            "This section covers risk estimation including foreseeable misuse scenarios "
            "and impacts on vulnerable groups.",
            "",
        ]
        for risk in confirmed_risks:
            lines += [
                f"### {risk.id}: {risk.title}",
                "",
                f"**Category**: {risk.category}  ",
                f"**Severity**: {risk.severity.value}  ",
                f"**Likelihood**: {risk.likelihood.value.replace('_', ' ')}  ",
            ]
            if risk.affects_vulnerable_groups and risk.vulnerable_groups:
                lines.append(f"**Vulnerable groups**: {', '.join(risk.vulnerable_groups)}  ")
            lines.append("")
            if risk.review_notes:
                lines += [f"**Review notes**: {risk.review_notes}", ""]
            if risk.misuse_scenarios:
                lines.append("**Misuse scenarios:**")
                lines.append("")
                for ms in risk.misuse_scenarios:
                    vg = f" *(affects: {ms.vulnerable_group})*" if ms.vulnerable_group else ""
                    lines += [
                        f"- **Actor**: {ms.actor}{vg}",
                        f"  - *Scenario*: {ms.description}",
                        f"  - *Consequence*: {ms.consequence}",
                        f"  - *Likelihood*: {ms.likelihood.value.replace('_', ' ')}",
                        "",
                    ]
            lines.append("")

        # Mitigation Measures
        lines += [
            "## 5. Mitigation Measures (Art. 9(2)(d))",
            "",
            "Mitigations are assigned following the required hierarchy: "
            "eliminate by design → reduce → mitigate → inform/train.",
            "",
            "| Measure ID | Title | Hierarchy Level | Assigned to Risks | Source |",
            "|------------|-------|-----------------|-------------------|--------|",
        ]
        for m in register.mitigations:
            lines.append(
                f"| {m.id} | {m.title} | {_HIERARCHY_LABEL.get(m.hierarchy_level, m.hierarchy_level.value)} | "
                f"{', '.join(m.assigned_to_risk_ids)} | {m.source} |"
            )
        lines.append("")

        # Implementation guidance
        lines += ["### Implementation Guidance", ""]
        for m in register.mitigations:
            if m.implementation_guidance:
                lines += [
                    f"**{m.id} — {m.title}**",
                    "",
                    m.implementation_guidance,
                    "",
                ]

        # Risk classification
        if register.risk_classification:
            rc = register.risk_classification
            badge = {"unacceptable": "🚫", "high": "🔴", "limited": "🟡", "minimal": "🟢"}.get(rc.risk_level, "")
            lines += [
                "## 6. EU AI Act Risk Classification",
                "",
                f"| Field | Value |",
                f"|-------|-------|",
                f"| Risk Level | {badge} **{rc.risk_level.upper()}** |",
                f"| Annex III Match | {'Yes — point ' + rc.annex_iii_point if rc.annex_iii_match else 'No'} |",
                f"| Confidence | {rc.confidence} |",
                f"| Reasoning | {rc.reasoning} |",
                "",
            ]

        # Vulnerable groups
        if register.vulnerable_group_assessments:
            lines += [
                "## 7. Vulnerable Groups Assessment (Art. 9(9))",
                "",
                "The following vulnerable groups were identified as potentially subject to disproportionate impact:",
                "",
            ]
            for vga in register.vulnerable_group_assessments:
                reviewed_badge = "✅ Reviewed" if vga.reviewed else "⚠️ Pending review"
                lines += [
                    f"### {vga.group.title()} — {reviewed_badge}",
                    "",
                    f"*Identified by*: {vga.identified_by}",
                    "",
                ]
                if vga.risk_ids:
                    lines.append(f"*Associated risks*: {', '.join(vga.risk_ids)}")
                    lines.append("")
                if vga.specific_safeguards:
                    lines.append("**Required safeguards:**")
                    lines.append("")
                    for s in vga.specific_safeguards:
                        lines.append(f"- {s}")
                    lines.append("")
                if vga.reviewer_notes:
                    lines += [f"*Reviewer notes*: {vga.reviewer_notes}", ""]

        # Related incidents
        if register.related_incidents:
            lines += [
                "## 8. Related AI Incidents (Art. 9(2)(a))",
                "",
                "The following real-world incidents from the AI Incident Database are relevant to this system "
                "and inform the foreseeable risk catalogue:",
                "",
            ]
            for inc in register.related_incidents:
                url_part = f" ([source]({inc.url}))" if inc.url else ""
                lines += [
                    f"### {inc.incident_id}: {inc.title}{url_part}",
                    "",
                    inc.description,
                    "",
                    f"*Relevance*: {inc.relevance_reason}",
                    "",
                ]

        # Residual Risk
        lines += [
            "## 9. Residual Risk Assessment (Art. 9(5))",
            "",
        ]
        if register.residual_risk_argument and register.residual_risk_argument.claim:
            arg = register.residual_risk_argument
            lines += [
                "**Acceptability claim:**",
                "",
                f"> {arg.claim}",
                "",
                "**Supporting evidence:**",
                "",
            ]
            for e in arg.evidence:
                lines.append(f"- {e}")
            lines += ["", "**Assumptions:**", ""]
            for a in arg.assumptions:
                lines.append(f"- {a}")
            lines += ["", "**Open issues / limitations:**", ""]
            for o in arg.open_issues:
                lines.append(f"- {o}")
            lines.append("")
            sign_off = "✅ Expert sign-off obtained" if arg.expert_sign_off else "⚠️ Expert sign-off **not yet obtained** — required before deployment"
            lines += [sign_off, ""]
        else:
            lines += [
                "> **Note**: A full formal assurance case for residual risk acceptability (Art. 9(5)) "
                "is out of scope for this prototype version.",
                "",
            ]

        if register.review_complete:
            status = "acceptable" if register.residual_risk_acceptable else "not yet assessed as acceptable"
            lines += [
                f"Following the application of all mitigation measures listed above, "
                f"residual risk is assessed as: **{status}**.",
                "",
            ]
        if register.notes:
            lines += [f"**Notes**: {register.notes}", ""]

        # Audit log
        if register.audit_log:
            audit_logger = AuditLogger(register)
            lines += [
                "## 10. Audit Log (Art. 12)",
                "",
                "All risk assessment actions are recorded below for traceability and accountability.",
                "",
                audit_logger.to_markdown(),
                "",
            ]

        # Appendix
        lines += [
            "## Appendix",
            "",
            "### A. Generation Configuration",
            "",
            "```json",
            json.dumps(register.generation_config, indent=2),
            "```",
            "",
            "### B. Taxonomy Sources",
            "",
            "| Taxonomy | Full Name |",
            "|----------|-----------|",
            "| AI_Act | EU AI Act 2024/1689 |",
            "| NIST_AI_RMF | NIST AI Risk Management Framework 1.0 |",
            "| MIT_AIRR | MIT AI Risk Repository |",
            "| OWASP_LLM | OWASP Top 10 for LLM Applications 2025 |",
            "",
            "### C. Out of Scope",
            "",
            "The following Art. 9 elements are **not covered** by this version:",
            "",
            "- **Art. 9(2)(c)**: Feedback loop with post-market monitoring data",
            "- **Art. 9(5)**: Full formal expert-witnessed assurance case",
            "",
        ]

        return "\n".join(lines)

    def to_instructions_for_use(self, register: RiskRegister) -> str:
        """
        Generate an Article 13-compliant 'Instructions for Use' document from the risk register.

        Art. 13(1) requires high-risk AI systems to be accompanied by instructions enabling
        deployers to use the system appropriately and implement human oversight.
        Art. 13(3) specifies required content: provider identity, capabilities and limitations,
        accuracy metrics, human oversight measures, expected lifetime and maintenance.
        """
        sys = register.system
        confirmed_risks = [r for r in register.risks if r.confirmed and not r.dismissed]
        critical_and_high = [r for r in confirmed_risks if r.severity in (SeverityLevel.CRITICAL, SeverityLevel.HIGH)]
        mitigations_by_level: dict[str, list[MitigationMeasure]] = {}
        for m in register.mitigations:
            key = m.hierarchy_level.value
            mitigations_by_level.setdefault(key, []).append(m)

        lines: list[str] = []

        # Cover page
        lines += [
            f"# Instructions for Use",
            f"## {sys.name} — Version {sys.version}",
            "",
            f"**Document type**: Instructions for Use (EU AI Act Article 13)",
            f"**Provider**: {sys.developer_org or 'Not specified'}",
            f"**AI System**: {sys.name} v{sys.version}",
            f"**EU AI Act Risk Level**: {register.risk_classification.risk_level.upper() if register.risk_classification else 'HIGH (Annex III)'}",
            f"**Annex III Category**: {sys.annex_iii_category.value.replace('_', ' ').title()} (point {sys.annex_iii_point})",
            f"**Generated from Risk Register**: {register.id}",
            f"**Date**: {register.created_at.strftime('%Y-%m-%d')}",
            "",
            "> This document has been automatically generated from the AI Risk Register in accordance with",
            "> EU AI Act Article 13 (Transparency and provision of information to deployers).",
            "> It must be reviewed and supplemented by qualified personnel before deployment.",
            "",
        ]

        # 1. Provider identity (Art. 13(3)(a))
        lines += [
            "---",
            "",
            "## 1. Provider Identity and Contact (Art. 13(3)(a))",
            "",
            f"| Field | Value |",
            f"|-------|-------|",
            f"| Provider / Developer | {sys.developer_org or 'Not specified'} |",
            f"| AI System Name | {sys.name} |",
            f"| Version | {sys.version} |",
            f"| Intended Use Category | Annex III — {sys.annex_iii_category.value.replace('_', ' ').title()} |",
            "",
            "> **Note**: Contact details, EU representative information (if applicable), and",
            "> support channels must be added here before deployment.",
            "",
        ]

        # 2. Characteristics, capabilities and limitations (Art. 13(3)(b))
        lines += [
            "## 2. Characteristics, Capabilities and Limitations (Art. 13(3)(b))",
            "",
            "### 2.1 Intended Purpose",
            "",
            f"{sys.intended_purpose}",
            "",
            "### 2.2 Intended Users",
            "",
        ]
        for u in sys.intended_users:
            lines.append(f"- {u}")
        lines += [
            "",
            "### 2.3 Deployment Context",
            "",
            f"{sys.deployment_context}",
            "",
            "### 2.4 AI Techniques Used",
            "",
        ]
        for t in sys.ai_techniques:
            lines.append(f"- {t}")
        lines += [
            "",
            "### 2.5 Data Inputs",
            "",
        ]
        for d in sys.data_inputs:
            lines.append(f"- {d}")
        lines += [
            "",
            "### 2.6 Performance Characteristics",
            "",
            "> **Required**: Insert accuracy metrics, benchmark results, and performance thresholds here.",
            "> These must include: overall accuracy, performance per subgroup (especially protected",
            "> characteristics), false positive / false negative rates, and conditions under which",
            "> performance degrades.",
            "",
        ]

        # 3. Known limitations and risks (Art. 13(3)(b)(iv))
        lines += [
            "## 3. Known Limitations and Identified Risks (Art. 13(3)(b)(iv))",
            "",
            "The following risks have been identified through the Article 9 risk assessment process.",
            "Deployers must be aware of these limitations when operating this system.",
            "",
        ]
        if critical_and_high:
            lines += [
                "### 3.1 Critical and High Risks",
                "",
                "| Risk ID | Title | Category | Severity | Action Required |",
                "|---------|-------|----------|----------|-----------------|",
            ]
            for r in critical_and_high:
                action = "Immediate human review mandatory" if r.severity == SeverityLevel.CRITICAL else "Human oversight required"
                lines.append(f"| {r.id} | {r.title} | {r.category} | **{r.severity.value.upper()}** | {action} |")
            lines.append("")

        if confirmed_risks:
            lines += [
                "### 3.2 All Identified Risks Summary",
                "",
                "| Risk ID | Title | Severity | Likelihood | Affects Vulnerable Groups |",
                "|---------|-------|----------|------------|---------------------------|",
            ]
            for r in confirmed_risks:
                vg = "Yes" if r.affects_vulnerable_groups else "No"
                lines.append(
                    f"| {r.id} | {r.title} | {r.severity.value} | "
                    f"{r.likelihood.value.replace('_', ' ')} | {vg} |"
                )
            lines.append("")

        # 4. Human oversight measures (Art. 13(3)(d))
        lines += [
            "## 4. Human Oversight Measures (Art. 13(3)(d))",
            "",
            "Deployers are required to implement human oversight in accordance with Article 14.",
            "The following measures have been identified through the risk assessment:",
            "",
        ]
        inform_mitigations = mitigations_by_level.get("inform", [])
        mitigate_mitigations = mitigations_by_level.get("mitigate", [])
        if inform_mitigations or mitigate_mitigations:
            for m in (inform_mitigations + mitigate_mitigations):
                lines += [
                    f"### {m.id}: {m.title}",
                    "",
                    m.description,
                    "",
                ]
                if m.implementation_guidance:
                    lines += [f"**Implementation guidance**: {m.implementation_guidance}", ""]
        else:
            lines += [
                "The following general oversight requirements apply:",
                "",
                "- A qualified human reviewer must be designated before system deployment",
                "- All high-risk decisions must allow human override",
                "- Outputs must be monitored and reviewed at regular intervals",
                "- Users must be trained to understand the system's limitations",
                "",
            ]

        lines += [
            "### Oversight Capability Requirements",
            "",
            "Deployers must ensure that persons assigned to oversight:",
            "",
            "- Understand the AI system's capabilities and limitations described in this document",
            "- Are able to interpret the system's outputs correctly",
            "- Are empowered to override or halt the system when necessary",
            "- Have received adequate training on AI-assisted decision-making",
            "",
        ]

        # 5. Vulnerable groups (Art. 13(3)(b)(v))
        if register.vulnerable_group_assessments:
            lines += [
                "## 5. Special Considerations for Vulnerable Groups (Art. 9(9), Art. 13(3)(b)(v))",
                "",
                "This system may have disproportionate impact on the following groups.",
                "Deployers must apply additional safeguards when the system is used in contexts",
                "involving these populations:",
                "",
            ]
            for vga in register.vulnerable_group_assessments:
                lines += [f"### {vga.group.title()}", ""]
                if vga.specific_safeguards:
                    lines.append("**Required safeguards:**")
                    lines.append("")
                    for s in vga.specific_safeguards:
                        lines.append(f"- {s}")
                    lines.append("")

        # 6. Technical measures (Art. 13(3)(c))
        eliminate = mitigations_by_level.get("eliminate", [])
        reduce = mitigations_by_level.get("reduce", [])
        if eliminate or reduce:
            lines += [
                "## 6. Technical Risk Reduction Measures (Art. 13(3)(c))",
                "",
                "The following technical measures have been implemented to reduce identified risks:",
                "",
            ]
            for m in eliminate + reduce:
                badge = "🔷 Eliminated by design" if m.hierarchy_level == MitigationHierarchyLevel.ELIMINATE else "🔶 Reduced"
                lines += [
                    f"- **{m.title}** ({badge})",
                    f"  {m.description}",
                    "",
                ]

        # 7. Conditions of use and contraindications (Art. 13(3)(b)(ii-iii))
        lines += [
            "## 7. Conditions of Use and Contraindications (Art. 13(3)(b)(ii-iii))",
            "",
            "### 7.1 Intended Conditions of Use",
            "",
            f"- This system is designed for use in: **{sys.deployment_context}**",
            f"- Authorised users: {', '.join(sys.intended_users) if sys.intended_users else 'As specified by deployer'}",
            "",
            "### 7.2 Contraindications — Do Not Use When:",
            "",
            "> **Required**: List specific situations where the system must NOT be used.",
            "> Examples: outside tested data distribution, on populations not represented in training data,",
            "> as sole decision-maker for consequential decisions, without qualified human oversight.",
            "",
            "### 7.3 Changes Requiring Re-assessment",
            "",
            "A new risk assessment is required when:",
            "",
            "- The intended purpose changes",
            "- The system is deployed in a substantially different context",
            "- Significant technical changes are made to the underlying model",
            "- New evidence of harm emerges from post-market monitoring",
            "",
        ]

        # 8. Maintenance and lifecycle (Art. 13(3)(e))
        lines += [
            "## 8. Maintenance, Monitoring and Lifecycle (Art. 13(3)(e))",
            "",
            "### 8.1 Post-Market Monitoring",
            "",
            "Deployers must implement a post-market monitoring plan in accordance with Art. 72 and",
            "ensure that relevant incidents and near-misses are reported.",
            "",
            "| Monitoring Requirement | Frequency |",
            "|------------------------|-----------|",
            "| Performance review against accuracy thresholds | Quarterly |",
            "| Bias and fairness audit | Annually or on data distribution shift |",
            "| Security and adversarial robustness test | Annually |",
            "| Human oversight adequacy review | Annually |",
            "",
            "### 8.2 Incident Reporting",
            "",
            "Serious incidents must be reported to the relevant national supervisory authority in",
            "accordance with Art. 73. A serious incident is any malfunction or use of the system",
            "that directly or indirectly leads to death, serious harm, or violation of fundamental rights.",
            "",
            "### 8.3 Decommissioning",
            "",
            "> **Required**: Define end-of-life procedures — data deletion, handover to successor system,",
            "> notification of affected persons.",
            "",
        ]

        # 9. Residual risk declaration (Art. 9(5) + Art. 13)
        lines += [
            "## 9. Residual Risk Declaration",
            "",
        ]
        if register.residual_risk_argument and register.residual_risk_argument.claim:
            arg = register.residual_risk_argument
            lines += [
                f"> {arg.claim}",
                "",
            ]
            if arg.open_issues:
                lines += ["**Open issues that deployers must address:**", ""]
                for o in arg.open_issues:
                    lines.append(f"- {o}")
                lines.append("")
            sign_off = (
                "✅ Residual risk acceptability has been confirmed by a qualified expert."
                if arg.expert_sign_off
                else "⚠️ **Expert sign-off is required before deployment.** "
                     "A qualified person must review and confirm residual risk acceptability."
            )
            lines += [sign_off, ""]
        else:
            lines += [
                "> A formal residual risk acceptability assessment must be completed and signed off",
                "> by a qualified expert before this system is placed on the market or put into service.",
                "",
            ]

        # 10. Legal and compliance notices
        lines += [
            "## 10. Legal and Compliance Notices",
            "",
            f"This AI system is classified as **high-risk** under Annex III of the EU AI Act",
            f"(Regulation 2024/1689), point {sys.annex_iii_point}.",
            "",
            "Before placing this system on the market or putting it into service, the provider must:",
            "",
            "- [ ] Register the system in the EU database (Art. 49)",
            "- [ ] Affix CE marking (Art. 48)",
            "- [ ] Issue an EU Declaration of Conformity (Art. 47)",
            "- [ ] Implement a post-market monitoring plan (Art. 72)",
            "- [ ] Ensure a quality management system is in place (Art. 17)",
            "- [ ] Complete a fundamental rights impact assessment where required (Art. 27)",
            "",
            "---",
            "",
            "*This document was generated automatically from an AI Risk Register.*",
            "*It does not constitute legal advice. For binding compliance determinations,*",
            "*consult a qualified legal expert specialising in EU AI Act compliance.*",
            "",
        ]

        return "\n".join(lines)
        out = Path(output_dir)
        out.mkdir(parents=True, exist_ok=True)
        slug = f"{register.system.name.lower().replace(' ', '_')}_{register.id[:8]}"
        json_path = out / f"{slug}.json"
        md_path = out / f"{slug}.md"
        json_path.write_text(self.to_json(register), encoding="utf-8")
        md_path.write_text(self.to_markdown(register), encoding="utf-8")
        return json_path, md_path

    def _fmt_residual(self, val: bool | None) -> str:
        if val is None:
            return "Not yet assessed"
        return "Yes" if val else "No"
