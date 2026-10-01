# Risk Management Module — Review Checklist

Use this checklist when reviewing a risk register before it is submitted for approval, or before an
approved register is handed to a compliance officer, legal team, or external auditor.

This checklist is intended for **AI engineers, AI compliance officers, and technical reviewers**.

---

## System information

- [ ] The system's EU AI Act tier (visible on the register page's "System info" section) matches
      its actual deployment context
- [ ] Intended users and deployment context are accurately reflected in the linked AI System
      Registry entry

---

## Risk identification

- [ ] Every risk relevant to this system's known failure modes has been entered — either from
      scratch or imported from the Risk Library
- [ ] No duplicate risks (same hazard entered twice under different titles)
- [ ] Each risk's category and description are specific to this system (not generic boilerplate
      copied from the library without adaptation)
- [ ] Misuse scenarios are specific and plausible, with a linked risk

---

## Risk evaluation

- [ ] Severity (Severe / Significant / Moderate / Minor) and likelihood (Very likely / Likely /
      Possible / Unlikely) are reasonable for this system, not defaulted without consideration
- [ ] Impact category (Health / Safety / Fundamental Rights / Others) is set and matches the
      described harm
- [ ] The auto-calculated risk level (Unacceptable / Substantial / Moderate / Acceptable) is
      consistent with the chosen severity and likelihood (it is computed automatically — flag if it
      looks wrong, as that would indicate a defect, not a data error)
- [ ] A responsible role (AI Engineer and/or AI Compliance Officer) is assigned to every risk —
      a risk with no responsible role shows a warning and cannot be meaningfully confirmed
- [ ] Both required roles have confirmed the evaluation (check the per-role confirmation bar on
      each risk) — an edited risk resets both confirmations, so re-confirm after any change
- [ ] All required fields are filled in for every risk (title, category, description, severity,
      likelihood, responsible role, deadline) — a risk with any of these missing is marked **not
      completed** and will not count as confirmed even if both roles click confirm

---

## Mitigation measures

- [ ] Each risk with an unacceptable or substantial risk level has at least one mitigation
- [ ] Elimination- and reduction-level measures have been considered first, not skipped straight to
      "inform"
- [ ] Implementation notes are actionable (not vague placeholders)
- [ ] No mitigation refers to a feature or process that does not exist in the system

---

## Residual risk

- [ ] Every risk has a residual status set (acceptable / unacceptable) after mitigations are
      applied
- [ ] Risks with residual status **unacceptable** have at least one plan task linked (via the
      risk's own plan-task list) — required before the register can be approved
- [ ] Risks with residual status **acceptable** have a plan task linked to **every** mitigation on
      that risk (not just the risk as a whole) — also required before approval
- [ ] The overall residual risk argument on the register is specific to this system (not a template
      copy-paste), references actual evidence (test reports, audits), and its verdict is consistent
      with the per-risk residual statuses above

---

## Incidents

- [ ] Any incident that has occurred since the last review is logged, with a link to the risk it
      relates to where applicable
- [ ] Incident descriptions are factual and specific (date, what happened, impact)

---

## Before approving

- [ ] Reviewer is set and the scheduled review date is within 6 months
- [ ] The register has at least one risk
- [ ] For HIGH-tier / prohibited systems: every risk has at least one mitigation (enforced by the
      platform — approval is blocked otherwise)

---

## Export quality

- [ ] The exported report (via **Export Report** on an approved register, or **Export** on an
      archived version) opens correctly and all sections are populated
- [ ] System name and tier in the report match the actual system
- [ ] For an archived version's export: the "ARCHIVED" banner is visible, making clear it is not
      the current approved state

---

## Known limitations to flag to the compliance officer

- Risk identification is entirely manual — there is no automated or LLM-assisted suggestion of
  risks; completeness depends on the reviewers' domain knowledge and the Risk Library's coverage
- There is no automated post-market monitoring ingestion (e.g. from a webhook or log pipeline) —
  incidents must be entered manually
- Reassessment triggers must be created manually (e.g. after a model change); there is no automatic
  trigger from registry or deployment events yet

---

*This checklist does not constitute legal advice.*
