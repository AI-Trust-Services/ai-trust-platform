# Pipeline (Phase 1) — Visualisierung

Bildet ab, was der Code unter `experiments/document-indexing/` heute tatsächlich tut.
Rendert direkt in GitHub und in VS Code (Mermaid-Preview).

```mermaid
flowchart TD
    %% ---------------- Ingestion ----------------
    subgraph INGEST["📄 Ingestion — ingest.py"]
        direction TB
        DOC[/"Dokument<br/>PDF · DOCX · PPTX · MD · HTML"/]
        CONV["DocumentConverter.convert()<br/>raises_on_error=False<br/>⚠️ Fehler → skip + laute Warnung"]
        CHUNK["HybridChunker<br/>Tokenizer = BGE-M3<br/>max_tokens = 256 / 512 (Knopf)"]
        CHOBJ["Chunk<br/>• text — roh (Anzeige · BM25 · Substring)<br/>• embed_text — contextualize() fürs Embedding<br/>• pages · headings — Provenance"]
        DOC --> CONV --> CHUNK --> CHOBJ
    end

    %% ---------------- Indexierung ----------------
    subgraph INDEX["🗂️ Indexierung (offline) — embed.py · retrieval.py"]
        direction TB
        EMB["Embedder · BGE-M3 dense<br/>L2-normiert (return_dense)"]
        MAT[["doc_matrix<br/>N × 1024"]]
        BM25["BM25Channel<br/>(Stellvertreter für Postgres-FTS)"]
        EMB --> MAT
    end

    CHOBJ -- embed_text --> EMB
    CHOBJ -- text --> BM25

    %% ---------------- Query-Zeit ----------------
    subgraph QUERY["🔎 Query-Zeit — retrieval.py"]
        direction TB
        Q[/"Query"/]
        QEMB["BGE-M3 dense (Query)"]
        DRANK["dense_rank<br/>Brute-Force-Kosinus<br/>(exakt, kein ANN-Index)"]
        BRANK["BM25.rank"]
        RRF["rrf · Reciprocal Rank Fusion<br/>k = 60 · candidate_k = 50"]
        RER["Reranker (optional)<br/>bge-reranker-v2-m3<br/>Cross-Encoder über Top-Kandidaten"]
        Q --> QEMB --> DRANK
        Q --> BRANK
        DRANK --> RRF --> RER
        BRANK --> RRF
    end

    MAT -. Kandidaten .-> DRANK
    BM25 -. Kandidaten .-> BRANK

    %% ---------------- Messung ----------------
    subgraph EVAL["📊 Messung — evaluate.py"]
        direction TB
        M["Recall@10 (Go/No-Go)<br/>MRR@10 · P@1 · Latenz/Query"]
    end

    DRANK -- "① dense" --> M
    RRF   -- "② hybrid" --> M
    RER   -- "③ hybrid + rerank" --> M

    classDef opt stroke-dasharray:4 3;
    class RER opt;
```

## Legende

- **Drei evaluierte Konfigurationen** laufen durch dieselbe Pipeline und werden gegeneinander
  gemessen: **① dense** (nur Bedeutungs-Kanal) · **② hybrid** (dense + Wort-Kanal via RRF) ·
  **③ hybrid + rerank** (zusätzlich Cross-Encoder). Der Reranker ist **optional** (gestrichelt).
- **Zwei Texte pro Chunk:** eingebettet wird `contextualize()` (Heading-angereichert), im Index
  für BM25 / Anzeige / Substring-Match liegt der **Rohtext** — bewusst getrennt.
- **BM25** ist hier ein **in-process-Stellvertreter** für das spätere **Postgres-FTS** (Phase 2).
  Für die reine Qualitäts-Validierung ist die exakte FTS-Implementierung ein Detail.
- **Brute-Force-Kosinus, kein ANN:** korrekt für den kleinen, pro-AI-System gefilterten
  Suchraum — und im Spike methodisch nötig (ANN würde die Qualitätsmessung verfälschen).
- Detaillierter Kontext, offene Punkte und Phase 2: siehe [`../../document-indexing-plan.md`](../../document-indexing-plan.md).
