"""Phase-1-Eval-Runner.

Vergleicht drei Konfigurationen -- dense-only / hybrid / hybrid+rerank -- über die
konfigurierten Chunk-Größen und misst Recall@k + MRR@k + Präzision@1 auf dem
Ground-Truth-Set, plus grobe Latenz pro Query.

Ergebnisse landen zusätzlich (append) in einer CSV -- eine Zeile je Chunk-Größe ×
Konfiguration, mit Zeitstempel und Freitext-`--label` --, damit sich mehrere Läufe /
Varianten akkumulieren und vergleichen lassen.

    python evaluate.py --label "xquad-baseline"
    python evaluate.py --label "xquad-chunk-ctx-v2" --csv results.csv
    python evaluate.py --no-csv        # nur Tabelle, nichts schreiben
"""

from __future__ import annotations

import argparse
import csv
import time
from datetime import datetime
from pathlib import Path

import numpy as np
import yaml

import config
from embed import Embedder
from ingest import Chunk, ingest_dir
from retrieval import BM25Channel, Reranker, dense_rank, rrf

CONFIGS = ("dense", "hybrid", "hybrid+rerank")

CSV_HEADER = [
    "timestamp",
    "label",
    "mode",
    "n_questions",
    "k",
    "chunk_tokens",
    "config",
    "recall_at_k",
    "mrr_at_k",
    "precision_at_1",
    "latency_s_per_query",
]


def load_ground_truth(path) -> list[dict]:
    with open(path, encoding="utf-8") as fh:
        return yaml.safe_load(fh)["questions"]


def is_relevant(chunk: Chunk, gt: dict) -> bool:
    """Zwei Modi:

    - Dokument-Level (z. B. MLDR): `documents` gesetzt -> Treffer, wenn der Chunk aus
      einem der relevanten Dokumente stammt (keine Seiten-Labels vorhanden).
    - Location-Level (hand-gelabelt): `document` + `pages` und/oder `answer_substring`.
    """
    docs = gt.get("documents")
    if docs is not None:
        return chunk.document in docs

    if chunk.document != gt["document"]:
        return False
    pages = gt.get("pages")
    substring = gt.get("answer_substring")
    if not (pages or substring):
        return False  # Ground-Truth-Eintrag braucht mindestens ein Kriterium
    if pages and not (set(chunk.pages) & set(pages)):
        return False
    if substring and substring.lower() not in chunk.text.lower():
        return False
    return True


def first_hit_rank(order: list[int], chunks: list[Chunk], gt: dict) -> int | None:
    """0-basierter Rang der ersten relevanten Passage, sonst None."""
    for rank, idx in enumerate(order):
        if is_relevant(chunks[idx], gt):
            return rank
    return None


def metrics(ranks: list[int | None], k: int) -> tuple[float, float, float]:
    """Passagen-genaue Metriken über die 0-basierten Ränge der ersten relevanten Passage.

    - Recall@k -- wird die richtige Stelle überhaupt in den Top-k gefunden? (Go/No-Go)
    - MRR@k    -- steht sie weit oben?
    - Präzision@1 -- zeigt der zurückgegebene Top-Treffer (der Link) auf genau den
      antwort-tragenden Chunk? (Rang 0 relevant)
    """
    recall = float(np.mean([r is not None and r < k for r in ranks]))
    mrr = float(
        np.mean([1.0 / (r + 1) if (r is not None and r < k) else 0.0 for r in ranks])
    )
    p_at_1 = float(np.mean([r == 0 for r in ranks]))
    return recall, mrr, p_at_1


def _mode(questions: list[dict]) -> str:
    """Ground-Truth-Modus erkennen (für die CSV-Spalte)."""
    if questions and questions[0].get("documents") is not None:
        return "document-level"
    return "passage-level"


def run(csv_path: Path | None = None, label: str = "") -> None:
    questions = load_ground_truth(config.GROUND_TRUTH)
    embedder = Embedder(config.EMBED_MODEL, use_fp16=config.USE_FP16)
    reranker = Reranker(config.RERANKER_MODEL, use_fp16=config.USE_FP16)

    rows = []
    for max_tokens in config.CHUNK_SIZES:
        chunks = ingest_dir(config.DOCS_DIR, max_tokens)
        if not chunks:
            raise SystemExit(f"Keine Dokumente in {config.DOCS_DIR}")

        doc_matrix = embedder.encode([c.embed_text for c in chunks])
        bm25 = BM25Channel([c.text for c in chunks])
        query_vecs = embedder.encode([q["query"] for q in questions])

        hits = {cfg: [] for cfg in CONFIGS}
        latency = {cfg: 0.0 for cfg in CONFIGS}

        for gt, qv in zip(questions, query_vecs):
            t0 = time.perf_counter()
            dense_order = dense_rank(qv, doc_matrix)
            dense_t = time.perf_counter() - t0
            latency["dense"] += dense_t
            hits["dense"].append(first_hit_rank(dense_order, chunks, gt))

            t0 = time.perf_counter()
            bm25_order = bm25.rank(gt["query"])
            fused = rrf(
                [dense_order[: config.CANDIDATE_K], bm25_order[: config.CANDIDATE_K]],
                k=config.RRF_K,
            )
            fuse_t = time.perf_counter() - t0
            latency["hybrid"] += dense_t + fuse_t
            hits["hybrid"].append(first_hit_rank(fused, chunks, gt))

            t0 = time.perf_counter()
            candidates = [
                (idx, chunks[idx].text) for idx in fused[: config.CANDIDATE_K]
            ]
            rerank_order = reranker.rerank(gt["query"], candidates)
            rerank_t = time.perf_counter() - t0
            latency["hybrid+rerank"] += dense_t + fuse_t + rerank_t
            hits["hybrid+rerank"].append(first_hit_rank(rerank_order, chunks, gt))

        for cfg in CONFIGS:
            recall, mrr, p_at_1 = metrics(hits[cfg], config.EVAL_K)
            rows.append(
                (max_tokens, cfg, recall, mrr, p_at_1, latency[cfg] / len(questions))
            )

    _print_table(rows, n_questions=len(questions))
    if csv_path is not None:
        _write_csv(csv_path, rows, label=label, mode=_mode(questions), n=len(questions))


def _write_csv(path: Path, rows, label: str, mode: str, n: int) -> None:
    """Ergebnisse an die CSV anhängen (Header nur bei neuer Datei)."""
    k = config.EVAL_K
    timestamp = datetime.now().isoformat(timespec="seconds")
    is_new = not path.exists()
    with open(path, "a", newline="", encoding="utf-8") as fh:
        writer = csv.writer(fh)
        if is_new:
            writer.writerow(CSV_HEADER)
        for max_tokens, cfg, recall, mrr, p_at_1, lat in rows:
            writer.writerow(
                [
                    timestamp,
                    label,
                    mode,
                    n,
                    k,
                    max_tokens,
                    cfg,
                    f"{recall:.4f}",
                    f"{mrr:.4f}",
                    f"{p_at_1:.4f}",
                    f"{lat:.6f}",
                ]
            )
    print(f"-> {len(rows)} Zeilen an {path} angehängt (label={label!r}, mode={mode})")


def _print_table(rows, n_questions: int) -> None:
    k = config.EVAL_K
    print(f"\nGround-Truth: {n_questions} Fragen\n")
    print(
        f"{'chunk':>6} {'config':<15} {f'Recall@{k}':>10} {f'MRR@{k}':>9} "
        f"{'P@1':>7} {'lat/q(s)':>10}"
    )
    print("-" * 62)
    for max_tokens, cfg, recall, mrr, p_at_1, lat in rows:
        print(
            f"{max_tokens:>6} {cfg:<15} {recall:>10.3f} {mrr:>9.3f} "
            f"{p_at_1:>7.3f} {lat:>10.4f}"
        )
    print()


def main() -> None:
    parser = argparse.ArgumentParser(description="Phase-1-Eval-Runner (+ CSV-Log).")
    parser.add_argument(
        "--label",
        default="",
        help="Freitext-Tag für diesen Lauf (z. B. Datensatz/Variante), landet in der CSV.",
    )
    parser.add_argument(
        "--csv",
        default=str(config.RESULTS_CSV),
        help=f"CSV-Datei zum Anhängen (Default: {config.RESULTS_CSV}).",
    )
    parser.add_argument(
        "--no-csv",
        action="store_true",
        help="Nur Tabelle ausgeben, keine CSV schreiben.",
    )
    args = parser.parse_args()
    run(csv_path=None if args.no_csv else Path(args.csv), label=args.label)


if __name__ == "__main__":
    main()
