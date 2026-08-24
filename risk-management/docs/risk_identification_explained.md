# How Risk Identification Works

This document explains the risk identification pipeline in the Risk Management module — from system description to a list of candidate risks ready for human review.

---

## Pipeline overview

```
System description + Metadata
        │
        ▼
┌─────────────────────┐
│  RiskIdentifier     │  (orchestrator)
│  (identifier.py)    │
└──────────┬──────────┘
           │
    ┌──────┴──────┐
    │             │
    ▼             ▼
Rule-based     Stub / LLM
Backend        Backend
    │             │
    └──────┬──────┘
           │
    _dedup_risks()
           │
           ▼
  Candidate risk list
```

---

## Identification backends

### 1. Rule-based backend (`RuleBasedBackend`)

Always available, no network or LLM required. Works in two steps:

**Step 1 — Annex III category match**
Checks whether the system metadata `annex_iii_category` (e.g. `employment`, `biometric`) appears in the `applicable_annex_iii_categories` list of each taxonomy entry.

**Step 2 — Keyword match**
Concatenates the system description, purpose, deployment context, AI techniques, and data inputs into a single text, then searches it against the keywords from each taxonomy entry (e.g. `bias`, `facial recognition`, `credit score`).

A risk is included if **either** condition is met.

### 2. IBM Risk Atlas Nexus stub (`StubRiskAtlasNexusBackend`)

Deterministically simulates the response the real IBM Risk Atlas Nexus would return. Contains pre-defined taxonomy ID sets per Annex III category:

| Category | Sample taxonomy IDs |
|---|---|
| `employment` | TAX-001, TAX-002, TAX-003, TAX-004, TAX-005, TAX-006, TAX-012, … |
| `biometric` | TAX-001, TAX-004, TAX-005, TAX-008, TAX-016, TAX-017, … |
| `law_enforcement` | TAX-001, TAX-002, TAX-004, TAX-005, TAX-008, TAX-016, … |

The stub is used automatically when a demo system is selected. For custom systems the rule-based backend is used.

The target backend (`RiskAtlasNexusBackend`) raises `NotImplementedError` — see `docs/risk-atlas-nexus-integration-kickoff.md`.

### 3. LLM-assisted backend (`LLMAssistedBackend`)

Activated by the toggle in the UI. Sends a structured prompt to an LLM (Ollama or OpenAI-compatible) with system metadata and expects a JSON array response.

**System prompt** instructs the model that it is an Art. 9 expert and requires a JSON-only response.

**User prompt template** includes:
- System name and version
- Annex III category and point
- Purpose, users, deployment context
- Data inputs and AI techniques
- System description (max 3000 characters)

**Response parsing:**
1. Strips optional markdown fences (` ```json `)
2. Parses JSON
3. Maps fields to Pydantic models (`Risk`, `TaxonomyMapping`)

**Why temperature = 0.2?**
Low temperature minimises randomness and promotes concise, structured JSON. Higher values increase creativity at the cost of parsing reliability.

**Fallback mechanism:**
If the LLM is unavailable or returns invalid JSON, the backend automatically falls back to `RuleBasedBackend` and adds `"fallback_used": true` and the error message to `raw_output`.

---

## Merging and deduplication (`_dedup_risks`)

When LLM is enabled, rule-based and LLM results are merged:

1. **Deduplication key**: `risk.category` (e.g. `bias`, `transparency`)
2. **Conflict**: if two risks share the same category, the one with **higher severity** is kept
3. **Taxonomy mappings**: union of both risks' mappings (deduplicated by `(taxonomy, category)`)
4. **Vulnerable groups**: union of both group lists

Result: each risk category appears at most once in the final list.

---

## Risk taxonomy (`data/risk_taxonomy.json`)

The file contains ~25 entries. Each entry has the following structure:

```json
{
  "id": "TAX-001",
  "title": "Discrimination and Bias Risk",
  "category": "bias",
  "description": "...",
  "applicable_annex_iii_categories": ["employment", "essential_services", "education"],
  "default_severity": "high",
  "taxonomy_mappings": [
    {"taxonomy": "AI_Act", "category": "Art. 10(3)", "identifier": null},
    {"taxonomy": "NIST_AI_RMF", "category": "BIAS-2.5"},
    {"taxonomy": "MIT_AIRR", "category": "Fairness"},
    {"taxonomy": "OWASP_LLM", "category": "LLM06"}
  ],
  "keywords": ["discrimination", "bias", "fairness", "protected attribute"],
  "affects_vulnerable_groups": true,
  "common_vulnerable_groups": ["elderly persons", "persons with disabilities"]
}
```

---

## Interface contract for integrations

Every backend must implement `RiskIdentifierBackend`:

```python
class RiskIdentifierBackend(ABC):
    @abstractmethod
    def identify(
        self,
        system_description: str,
        metadata: AISystemMetadata,
        taxonomy_data: list[dict],
    ) -> RiskIdentificationResult: ...

    @property
    @abstractmethod
    def backend_name(self) -> str: ...
```

`RiskIdentificationResult` contains:
- `risks: list[Risk]` — identified risks
- `backend_used: str` — backend name (for logging and UI display)
- `raw_output: dict` — raw diagnostic data (e.g. matched taxonomy IDs, LLM response)

---

## Adding a new backend

1. Create a class inheriting `RiskIdentifierBackend` in `identifier.py`
2. Implement the `identify()` method returning `RiskIdentificationResult`
3. Implement the `backend_name` property returning a unique name
4. Update the `RiskIdentifier.identify()` orchestrator to handle the new backend
5. Add unit tests in `tests/unit/test_assessments.py`
