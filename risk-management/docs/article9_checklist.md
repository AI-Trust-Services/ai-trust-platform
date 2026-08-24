# EU AI Act Article 9 Compliance Checklist

Use this checklist to verify that a risk management cycle performed with this module meets the requirements of Article 9 of Regulation (EU) 2024/1689 (EU AI Act).

This checklist is intended for **AI engineers and compliance officers** reviewing an assessment before submission or audit.

---

## Art. 9(1) — Risk management system established

- [ ] A risk management system has been established and documented for this AI system
- [ ] The system covers the entire lifecycle of the AI system
- [ ] The risk management process is iterative (updated with new knowledge)

---

## Art. 9(2)(a) — Risks identified and analysed

- [ ] Risks from the intended purpose have been identified
- [ ] Risks from reasonably foreseeable misuse have been identified
- [ ] Risks have been mapped to at least one recognised taxonomy (EU AI Act, NIST AI RMF, MIT AIRR, or OWASP LLM)
- [ ] Each risk has been assigned a severity level (critical / high / medium / low)
- [ ] Each risk has been assigned a likelihood level
- [ ] At least one human reviewer has confirmed or dismissed each identified risk

---

## Art. 9(2)(b) — Risks evaluated

- [ ] Composite severity (severity × likelihood) has been calculated for each confirmed risk
- [ ] Misuse scenarios have been generated for each confirmed risk
- [ ] The AI system has been classified to an EU AI Act risk level (unacceptable / high / limited / minimal)
- [ ] Classification rationale is documented

---

## Art. 9(2)(c) — Post-market monitoring

- [ ] A plan for post-market monitoring is documented
- [ ] Mechanism for collecting incident data after deployment is defined

> **Note:** Post-market monitoring ingestion is not yet implemented in this module. See the roadmap in `README.md`.

---

## Art. 9(2)(d) — Mitigation measures assigned

- [ ] At least one mitigation measure has been assigned to each confirmed risk
- [ ] Mitigation measures follow the hierarchy: eliminate → reduce → mitigate → inform
- [ ] Implementation guidance is documented for each measure
- [ ] Source of each mitigation measure is recorded

---

## Art. 9(4) — Elimination or reduction of risks

- [ ] Risk elimination measures (design-level) have been considered before risk reduction measures
- [ ] Residual risks after mitigation have been identified

---

## Art. 9(5) — Residual risk acceptability

- [ ] A residual risk argument has been produced
- [ ] The argument includes: claim, evidence, assumptions, and open issues
- [ ] Overall verdict is documented (acceptable / conditional / unacceptable)
- [ ] Open issues are assigned for resolution

---

## Art. 9(9) — Vulnerable groups

- [ ] Groups that may be disproportionately affected have been identified
- [ ] Specific safeguards for each affected group are documented
- [ ] At least one human reviewer has reviewed vulnerable group impacts

---

## Art. 12 — Audit trail

- [ ] An audit log of all assessment actions is available
- [ ] The log records: timestamp, action type, actor, and affected entity
- [ ] The log is exportable (JSON or JSONL)

---

## Export

- [ ] Risk register has been exported in JSON format
- [ ] Risk register has been exported in Markdown format
- [ ] Both exports are stored in a document management system or version control

---

*This checklist does not constitute legal advice. For binding EU AI Act compliance determinations, consult a qualified legal professional.*
