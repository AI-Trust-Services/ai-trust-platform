# Phase 1 — Retrieval-Qualität validieren

Isoliertes Harness, das die einzige unbewiesene Annahme des Tickets beantwortet:
**Trägt `Docling → BGE-M3 → Hybrid-Retrieval` für unsere Dokumente?**

Self-contained, **keine Plattform-Infra nötig** (kein Postgres, kein Docker). Der
lexikalische Kanal ist hier **BM25 (in-process)** als getreuer Stellvertreter für das
spätere Postgres-FTS — für die reine *Qualitäts*-Validierung ist die exakte
FTS-Implementierung ein Detail; produktiv (Phase 2) kommt echtes FTS.

## Pipeline

```
Docling HybridChunker   (tokenizer=BGE-M3, max_tokens als Knopf; contextualize() fürs Embedding)
        │
        ├─ dense    : BGE-M3 dense  → brute-force Kosinus (exakt, kein ANN-Index)
        └─ lexikal. : BM25          → (Stellvertreter für Postgres-FTS)
        │
   RRF-Fusion  →  optionaler Reranker (bge-reranker-v2-m3)
```

## Ablauf

```bash
cd experiments/document-indexing
make setup                                   # .venv + Dependencies (zieht torch + Modelle, mehrere GB)
```

**Variante A — passagen-genauer Mechanik-Lauf (XQuAD, empfohlen):**

```bash
.venv/bin/python load_xquad.py --queries 200 --distractors 800   # Span-QA, passagen-genau
make eval
```

`load_xquad.py` zieht XQuAD (Span-QA aus SQuAD-1.1, professionell nach Deutsch übersetzt),
**bündelt** mehrere Absätze zu je einem längeren Dokument (Gold-Kontext + Distraktoren) und
schreibt `data/ground_truth.yaml` mit **Passagen-Level-Relevanz** (`document` +
`answer_substring`). Damit misst der Lauf, ob die *richtige Stelle* gefunden wird (AK 3/4/6),
nicht nur das richtige Dokument. Das ist der eigentliche Retrieval-Test.

**Variante B — Dokument-Level-Mechanik (MLDR-de):**

```bash
.venv/bin/python load_mldr.py --queries 50 --distractors 200   # lädt Sample, schreibt Docs + ground_truth.yaml
make eval
```

`load_mldr.py` zieht ein deutsches MLDR-Sample, schreibt die Korpus-Dokumente als `.md` nach
`data/documents/` und erzeugt `data/ground_truth.yaml` mit **Dokument-Level-Relevanz** (query →
relevante Dokumente). Verdrahtet die Kette, sagt aber nichts über die *Fundstelle* — deshalb
nur der frühe Mechanik-Beleg, nicht die eigentliche Messung.

**Variante C — eigene Dokumente (die eigentliche Entscheidungszahl):**

```bash
cp data/ground_truth.example.yaml data/ground_truth.yaml   # mit echten Fragen füllen
# Dokumente nach data/documents/ legen
make eval
```

Beim ersten Lauf lädt FlagEmbedding die Modelle (`bge-m3` ~2 GB, `bge-reranker-v2-m3`
~2 GB). Auf reiner CPU `USE_FP16 = False` in `config.py` setzen.

## Ground Truth

`data/ground_truth.yaml`: pro Frage die erwartete Fundstelle (`document` + `pages`
und/oder `answer_substring`). Fragen bewusst mischen — umformulierte (Semantik, AK 3)
und solche mit exaktem Term/ID (Wortsuche, AK 4). Siehe `ground_truth.example.yaml`.

**Zwei Datenquellen (siehe Plan):**
1. Öffentlicher Datensatz — **XQuAD** (passagen-genau, Variante A) bzw. MLDR (Dokument-Level,
   Variante B) → verdrahtet die Mechanik, gibt sie frei.
2. Reale Dokumente → liefern die **eigentliche** Go/No-Go-Zahl.

## Ausgabe & Interpretation

Tabelle je Chunk-Größe × Konfiguration mit **Recall@10** (Go/No-Go: wird die richtige Stelle
überhaupt gefunden?), **MRR@10** (steht sie oben?), **P@1** (zeigt der Top-Treffer / spätere
Link auf genau den antwort-tragenden Chunk?) und Latenz/Query.

- **Recall@10** ist die Entscheidungszahl. Richtwert für sauberes Material: ~0,8+.
- **P@1** ist die Präzisions-/Link-Zahl (nur passagen-genau aussagekräftig, also auf XQuAD /
  realen Docs — im Dokument-Level-Modus zählt sie jeden Chunk des richtigen Dokuments).
- Der Lift von `dense → hybrid → hybrid+rerank` zeigt, ob sich lexikalischer Kanal und
  Reranker lohnen (jeweils gegen ihren Latenz-Preis abwägen).
- Schwellwert **vor** dem realen-Doc-Lauf festnageln (nach der ersten öffentlichen Zahl
  kalibrieren), damit die Zahl nicht im Nachhinein wegrationalisiert wird.

### CSV-Log (Läufe vergleichen)

`evaluate.py` hängt jede Auswertung zusätzlich an eine CSV an (Default `results.csv`) —
eine Zeile je Chunk-Größe × Konfiguration, mit Zeitstempel, Freitext-`--label` und
auto-erkanntem Modus (passage- vs document-level). So akkumulierst du mehrere Varianten
(„Module") in einer Datei und vergleichst sie in Pandas/Excel.

```bash
make eval LABEL="xquad-baseline"                 # via Makefile
.venv/bin/python evaluate.py --label "chunk-ctx-v2"
.venv/bin/python evaluate.py --no-csv            # nur Tabelle, nichts schreiben
```

Spalten: `timestamp, label, mode, n_questions, k, chunk_tokens, config, recall_at_k,
mrr_at_k, precision_at_1, latency_s_per_query`.

## Dateien

| Datei | Zweck |
|---|---|
| `config.py` | Modelle, Chunk-Größen, k, Pfade |
| `load_xquad.py` | lädt XQuAD (Span-QA) → gebündelte Docs + passagen-genaue ground_truth.yaml |
| `load_mldr.py` | lädt MLDR-de-Sample → Docs + ground_truth.yaml (Dokument-Level-Mechanik) |
| `ingest.py` | Docling-Parse + HybridChunker → Chunks mit Provenance |
| `embed.py` | BGE-M3 dense Embeddings |
| `retrieval.py` | dense / BM25 / RRF / Reranker |
| `evaluate.py` | Runner: Konfigurationen vergleichen, Recall@10 + MRR@10 + P@1 |

Siehe `../../document-indexing-plan.md` für Phase 2 (produktiver Ausbau).
