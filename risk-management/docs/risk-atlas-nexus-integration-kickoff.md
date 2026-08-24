# Integration Kickoff — IBM Risk Atlas Nexus

## Context

The Risk Management module contains a `RiskAtlasNexusBackend` class in `risk_management/identifier.py` that currently raises `NotImplementedError`. The task is to implement this class so it calls the real IBM Risk Atlas Nexus library instead of returning pre-defined stub data.

Once the integration is complete, users will be able to select the `risk_atlas_nexus` backend instead of `stub` or `rule_based`, providing semantic risk search based on the IBM knowledge graph.

---

## Task

Implement `RiskAtlasNexusBackend` in `risk_management/identifier.py`.

The class must implement the `RiskIdentifierBackend` interface:

```python
class RiskAtlasNexusBackend(RiskIdentifierBackend):
    def identify(
        self,
        system_description: str,
        metadata: AISystemMetadata,
        taxonomy_data: list[dict],
    ) -> RiskIdentificationResult:
        ...

    @property
    def backend_name(self) -> str:
        return "risk_atlas_nexus"
```

---

## Interface contract

### Input

| Parameter | Type | Description |
|---|---|---|
| `system_description` | `str` | Full AI system description (up to 5000 characters) |
| `metadata` | `AISystemMetadata` | System metadata — see `risk_management/models.py` |
| `taxonomy_data` | `list[dict]` | Local taxonomy from `data/risk_taxonomy.json` (may be used as fallback) |

The `metadata.annex_iii_category` field accepts values from the `AnnexIIICategory` enum:
`biometric`, `critical_infrastructure`, `education`, `employment`, `essential_services`, `law_enforcement`, `migration`, `justice`, `other`

### Output

The method must return `RiskIdentificationResult`:

```python
class RiskIdentificationResult(BaseModel):
    risks: list[Risk]           # list of identified risks
    raw_output: dict            # diagnostic data for logging
    backend_used: str           # must be "risk_atlas_nexus"
```

Each `Risk` object must contain:

```python
class Risk(BaseModel):
    id: str                     # unique ID, e.g. "RISK-A1B2C3"
    title: str
    description: str
    category: str               # bias, transparency, privacy, reliability, ...
    source: RiskSource          # RiskSource.RISK_ATLAS_NEXUS
    taxonomy_mappings: list[TaxonomyMapping]
    default_severity: SeverityLevel
    severity: SeverityLevel
    likelihood: LikelihoodLevel
    affects_vulnerable_groups: bool
    vulnerable_groups: list[str]
    article_9_step: str         # default "9(2)(a)"
```

---

## Mapping guidance

### Severity mapping

Risk Atlas Nexus uses its own severity scale. Recommended mapping to `SeverityLevel`:

| Risk Atlas Nexus | SeverityLevel |
|---|---|
| `critical` / `very_high` | `SeverityLevel.CRITICAL` |
| `high` | `SeverityLevel.HIGH` |
| `medium` / `moderate` | `SeverityLevel.MEDIUM` |
| `low` / `minimal` | `SeverityLevel.LOW` |

### Category mapping

Risk Atlas Nexus risk categories should be mapped to local categories:

| Risk Atlas Nexus | Local category |
|---|---|
| `fairness`, `bias` | `bias` |
| `explainability`, `transparency` | `transparency` |
| `privacy`, `data_protection` | `privacy` |
| `robustness`, `reliability` | `reliability` |
| `human_agency`, `oversight` | `human_oversight` |
| `security`, `adversarial` | `security` |
| `governance`, `accountability` | `governance` |

### Risk ID generation

```python
import uuid
risk_id = f"RISK-{uuid.uuid4().hex[:6].upper()}"
```

Do not use original `atlas-risk-*` identifiers as the `Risk` model ID — they are too long. Preserve them in `raw_output` for diagnostic purposes.

---

## Testing instructions

### Unit tests

Add tests to `tests/unit/test_assessments.py`. Required test cases:

1. **Backend returns risks for an employment system** — mock the library returning sample risks
2. **Backend returns `backend_used = "risk_atlas_nexus"`**
3. **Backend handles library unavailability gracefully** — raises `LLMUnavailableError` or appropriate exception instead of crashing
4. **Severity mapping works correctly** — each Risk Atlas Nexus value maps to the correct `SeverityLevel`

### Integration test

```bash
cd risk-management/backend
make setup
# Run with real Risk Atlas Nexus library installed in venv
python -c "
from risk_management.identifier import RiskAtlasNexusBackend
from risk_management.models import AISystemMetadata, AnnexIIICategory

backend = RiskAtlasNexusBackend()
result = backend.identify(
    system_description='CV screening system using ML to rank candidates',
    metadata=AISystemMetadata(
        name='HireFilter',
        annex_iii_category=AnnexIIICategory.EMPLOYMENT,
        intended_purpose='Automated CV screening',
    ),
    taxonomy_data=[],
)
print(f'Backend: {result.backend_used}')
print(f'Risks: {len(result.risks)}')
for r in result.risks:
    print(f'  - [{r.severity}] {r.title}')
"
```

---

## Out of scope

The following are **out of scope** for this integration:

- Graph inference (cause-effect chain analysis)
- Synchronising the IBM risk base with the local taxonomy (`risk_taxonomy.json`)
- Post-market monitoring integration (Art. 9(2)(c))
- Exporting risks to IBM formats (e.g. SARIF, Risk Atlas Nexus native format)
- Caching Risk Atlas Nexus results

---

## Definition of Done

- [ ] `RiskAtlasNexusBackend.identify()` returns at least 3 risks for the sample demo systems
- [ ] `backend_used` = `"risk_atlas_nexus"` in the response
- [ ] Method handles library unavailability without crashing the service
- [ ] All unit tests pass: `make test-unit`
- [ ] Backend appears in logs as `risk_atlas_nexus` (not `stub` or `rule_based`)
- [ ] Updated `requirements.txt` with the Risk Atlas Nexus library version
- [ ] Updated `Dockerfile` if the integration requires additional system dependencies

---

## Questions to resolve before starting

1. Which version of Risk Atlas Nexus is the target? (check the latest release in the IBM repository)
2. Does the library require a network connection at runtime, or does it work fully offline after installation?
3. What embedding models are required and what is their size?
4. Do the licence terms allow deployment in a production environment?

Related document: `docs/risk-atlas-nexus-how-it-works.md`
