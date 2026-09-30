"""Zentrale Stellschrauben für das Phase-1-Retrieval-Harness."""

from __future__ import annotations

from pathlib import Path

# Modelle (BGE-M3-Familie, multilingual)
EMBED_MODEL = "BAAI/bge-m3"
RERANKER_MODEL = "BAAI/bge-reranker-v2-m3"

# Chunk-Größen (max_tokens im HybridChunker), die im Eval verglichen werden
CHUNK_SIZES = [256, 512]

# Retrieval-Tiefe
CANDIDATE_K = 50  # Kandidaten je Kanal / nach Fusion, die in den Reranker gehen
EVAL_K = 10  # k für Recall@k und MRR@k (Go/No-Go-Zahl)

# RRF-Konstante (Reciprocal Rank Fusion)
RRF_K = 60

# FlagEmbedding fp16 — auf reiner CPU ggf. auf False setzen
USE_FP16 = False

# Pfade
BASE_DIR = Path(__file__).resolve().parent
DOCS_DIR = BASE_DIR / "data" / "documents"
GROUND_TRUTH = BASE_DIR / "data" / "ground_truth.yaml"
RESULTS_CSV = BASE_DIR / "results.csv"  # Eval-Log (append), eine Zeile je Chunk×Config
