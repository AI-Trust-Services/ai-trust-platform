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

    def save(self, register: RiskRegister, output_dir: str) -> tuple[Path, Path]:
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
