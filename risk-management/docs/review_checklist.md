# Risk Management Module — Review Checklist

Use this checklist when reviewing a completed assessment before it is submitted to a compliance officer, legal team, or external auditor.

This checklist is intended for **developers, AI engineers, and technical reviewers**.

---

## Inputs

- [ ] System description is complete and accurately reflects the deployed system
- [ ] Annex III category is correctly assigned
- [ ] Intended users and deployment context are documented
- [ ] Data inputs and AI techniques are listed

---

## Risk identification

- [ ] The identification backend used is recorded (`backend_used` field in JSON export)
- [ ] If rule-based: keyword matches are plausible for this system type
- [ ] If LLM-assisted: raw LLM output is available in `raw_output` for audit
- [ ] If stub was used: the pre-defined risk set is appropriate for the Annex III category
- [ ] No obvious risks for this system type are missing from the identified list
- [ ] All identified risks have been reviewed (confirmed or dismissed) by a human

---

## Risk evaluation

- [ ] Severity and likelihood levels are reasonable for this system
- [ ] Misuse scenarios are specific and plausible (not generic boilerplate)
- [ ] Vulnerable group impacts are documented where applicable
- [ ] EU AI Act risk level classification matches the system's characteristics
- [ ] Related AI incidents from the AIID have been reviewed

---

## Mitigation measures

- [ ] Each confirmed risk has at least one assigned mitigation
- [ ] Elimination-level measures have been considered first (not skipped)
- [ ] Implementation guidance is actionable (not vague)
- [ ] No mitigation measure refers to a feature or process that does not exist in the system

---

## Residual risk argument

- [ ] The claim is specific to this system (not a template copy-paste)
- [ ] Evidence items reference actual artefacts (test results, audits, certifications)
- [ ] Assumptions are realistic and verifiable
- [ ] Open issues have owners and target resolution dates (add to reviewer notes if missing)
- [ ] Overall verdict is consistent with the evidence provided

---

## Export quality

- [ ] JSON export is valid and can be parsed: `python -c "import json; json.load(open('risk-register.json'))"`
- [ ] Markdown report is readable and all sections are populated
- [ ] System name and version in the report match the actual system
- [ ] Generated date is correct

---

## Known limitations to flag to the compliance officer

- LLM-assisted identification and residual risk argument generation may produce plausible but inaccurate content — all LLM outputs require human review
- Post-market monitoring (Art. 9(2)(c)) is not yet implemented in this module
- The residual risk argument is GSN-inspired but is not a certified formal assurance case
- IBM Risk Atlas Nexus backend is a stub — semantic search is not active

---

*This checklist does not constitute legal advice.*
