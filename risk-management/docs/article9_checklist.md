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
- [ ] Risks from reasonably foreseeable misuse have been identified (documented as misuse scenarios,
      each linked to a specific risk)
- [ ] Each risk has been assigned a severity level (Severe / Significant / Moderate / Minor)
- [ ] Each risk has been assigned a likelihood level (Very likely / Likely / Possible / Unlikely)
- [ ] Each risk has been assigned to at least one responsible role (AI Engineer and/or AI
      Compliance Officer), and that role (or both, if both are responsible) has confirmed or
      declined it

---

## Art. 9(2)(b) — Risks evaluated

- [ ] Risk level (severity × likelihood, auto-calculated as Unacceptable / Substantial / Moderate /
      Acceptable) is reviewed for every risk
- [ ] Misuse scenarios are documented for risks where reasonably foreseeable misuse applies
- [ ] The system's EU AI Act tier (Prohibited / High-risk / Limited / Minimal, assigned at
      registration in the AI System Registry) is correctly reflected in this register's context
- [ ] The tier's classification rationale (recorded at registration) is available for reference

---

## Art. 9(2)(c) — Post-market monitoring

- [ ] A plan for post-market monitoring is documented
- [ ] Mechanism for collecting incident data after deployment is defined

> **Note:** This module provides a manual incident log per register (the register's Incidents
> section), optionally linked to a specific risk. There is no automated post-market monitoring
> ingestion yet (e.g. a webhook or log-pipeline feed) — incidents must be entered by hand.

---

## Art. 9(2)(d) — Mitigation measures assigned

- [ ] At least one mitigation measure has been assigned to each risk (enforced by the platform at
      approval time for HIGH-risk and prohibited-tier systems)
- [ ] Mitigation measures follow the hierarchy: eliminate → reduce → mitigate → inform
- [ ] Implementation guidance is documented for each measure

---

## Art. 9(4) — Elimination or reduction of risks

- [ ] Risk elimination measures (design-level) have been considered before risk reduction measures
- [ ] Residual risks after mitigation have been identified (each risk's residual status: acceptable
      / unacceptable)

---

## Art. 9(5) — Residual risk acceptability

- [ ] A residual risk argument has been produced for the register as a whole (free-text, referencing
      concrete evidence such as test reports or audits — not a template copy-paste)
- [ ] The overall verdict is documented (Acceptable / Not acceptable)
- [ ] Risks with an unacceptable residual status have at least one linked plan task; risks with an
      acceptable residual status have a plan task linked to every one of their mitigations
      (both enforced by the platform at approval time)

---

## Art. 9(9) — Vulnerable groups

- [ ] Groups that may be disproportionately affected have been flagged on the relevant risk(s)
      ("Affects vulnerable groups") and named
- [ ] Specific impact on each affected group is documented
- [ ] Vulnerable-group impacts are covered by the same per-role confirmation as the rest of the risk
      (there is no separate confirmation step specific to vulnerable groups)

---

## Art. 12 — Record-keeping

- [ ] Prior assessment cycles are retained as read-only archived versions (visible as collapsed
      cards below the active register) — this is the primary record of how the register evolved
      over time, including a diff of what changed between cycles

> **Note:** This module does not currently write to the platform's central audit trail (the
> `audit` module's immutable action log) — risk register and risk actions are not among its
> instrumented action types yet. Register versioning (above) is the audit mechanism available
> today for this module specifically.

---

## Export

- [ ] The approved register has been exported as an HTML report (**Export Report** button) and
      opens correctly
- [ ] For an archived version, its own export (**Export** on the collapsed card) is clearly marked
      "ARCHIVED" and is not confused with the current approved state

---

*This checklist does not constitute legal advice. For binding EU AI Act compliance determinations, consult a qualified legal professional.*
