# IBM Risk Atlas Nexus — How It Works

This document explains what IBM Risk Atlas Nexus is, what architecture it uses, what the stub in this module simulates, and what it does not implement.

---

## What is IBM Risk Atlas Nexus

IBM Risk Atlas Nexus is an open-source library developed by IBM Research. It provides a structured knowledge base of AI risks along with tools for mapping, detecting, and reporting them.

Key characteristics:
- **Knowledge graph** — AI risks represented as entities in a graph with relationships between them (cause → effect, risk → mitigation, risk → legal article)
- **Taxonomy coverage** — mappings to EU AI Act, NIST AI RMF, ISO/IEC 42001, MIT AIRR, OWASP LLM Top 10
- **LinkML** — data schema based on LinkML, ensuring validation and interoperability
- **Risk identifiers** — unique identifiers (e.g. `atlas-risk-001`) enabling risk tracking across systems
- **Semantic search** — the library enables searching for risks based on system descriptions using embeddings

---

## What the stub does not implement

`StubRiskAtlasNexusBackend` (in `identifier.py`) deterministically simulates a library response based on the Annex III category. It does not implement:

| Risk Atlas Nexus feature | Status in module |
|---|---|
| Semantic search with embeddings | ❌ Not implemented |
| IBM knowledge graph | ❌ Replaced by local taxonomy (`risk_taxonomy.json`) |
| `atlas-risk-*` identifiers | ❌ Local `TAX-XXX` IDs used instead |
| Graph inference (cause-effect chains) | ❌ Not implemented |
| Auto-update on new library versions | ❌ Not implemented |
| Risk Atlas Nexus REST API / Python SDK | ❌ Does not call the library — stub returns pre-defined data |

---

## Knowledge graph architecture

Risk Atlas Nexus models risks as graph nodes:

```
AISystem
   │
   ├── hasRisk ──► Risk ──► hasTaxonomyMapping ──► EU_AI_Act_Article
   │                │
   │                ├── hasMitigation ──► MitigationMeasure
   │                │
   │                └── affectsGroup ──► VulnerableGroup
   │
   └── hasContext ──► DeploymentContext
```

The graph enables queries such as:
- "What risks are typical for biometric systems deployed by law enforcement?"
- "Which mitigations address both bias and privacy simultaneously?"
- "Which EU AI Act articles are linked to this risk?"

The stub cannot answer such questions — it returns pre-defined lists based on the Annex III category.

---

## Gap analysis

| Area | Stub | Full integration |
|---|---|---|
| Risk identification | Pre-defined lists by category | Knowledge graph + semantic embeddings |
| Matching precision | Medium (category as proxy) | High (system description analysed semantically) |
| Taxonomy mappings | Maintained manually in `risk_taxonomy.json` | Automatically from IBM graph |
| Taxonomy updates | Manual | Automatic on library update |
| Cross-system risk tracking | None (local IDs) | Possible via `atlas-risk-*` identifiers |

---

## Integration risks

1. **Licence** — verify Risk Atlas Nexus licence terms before any production deployment
2. **Dependencies** — the library may require additional dependencies (numpy, sentence-transformers) that increase Docker image size
3. **Embedding models** — semantic search requires downloading an embedding model (~500 MB) on first run
4. **API stability** — the library is actively developed; the API may change between versions

---

## References

- Repository: [github.com/IBM/risk-atlas-nexus](https://github.com/IBM/risk-atlas-nexus)
- Documentation: available in the IBM repository
- LinkML schema: `risk_atlas_nexus/schema/`
- Related integration document: `docs/risk-atlas-nexus-integration-kickoff.md`
