# Task: EU AI Act Risk-Tier Classification

Classify this AI system's **risk tier** under the EU AI Act and identify the
applicable obligations.

## What to deliver

1. **Risk tier** — one of: `prohibited`, `high`, `limited`, `minimal`, or
   `general_purpose`. State it clearly at the start of `proposed_answer`.
2. **Annex / Article basis** — the specific provision(s) that determine the tier
   (e.g. Annex III, point 4 — employment screening).
3. **Key obligations** — the 3–5 most critical compliance obligations for this
   system at the identified tier.
4. **Confidence assessment** — how confident are you (0–1) and why?

## Required retrieval

Call all three tools with questions tailored to the system's described purpose:

- `retrieve_legal_sources`: "Which EU AI Act Annex III categories or prohibitions
  apply to [describe system purpose]?"
- `retrieve_reviewed_judgments`: "What precedents or expert opinions exist for
  [describe system purpose] classification?"
- `retrieve_system_evidence`: "What technical documentation supports or contradicts
  [risk aspect] for this system?"

## Guidance

- Annex III lists 8 high-risk areas; check each for a plausible match.
- Art. 6 §1 addresses embedded high-risk components; §2 covers standalone systems.
- Art. 5 lists 4 prohibited uses; check them first.
- GPAI models (Art. 51–52) are a separate track from the Annex III categories.
- Limited risk (Art. 50) applies mainly to chatbots and emotion/biometric systems
  with disclosure obligations.
- Minimal risk applies when none of the above triggers are met.
