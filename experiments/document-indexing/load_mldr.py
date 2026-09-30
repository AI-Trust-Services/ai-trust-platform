"""Lädt eine Teilmenge von MLDR (deutsch) ins Harness-Format.

MLDR ist ein Long-Document-Retrieval-Benchmark des BGE-M3-Teams (13 Sprachen inkl.
Deutsch, Dokumente ~4.700 Tokens). Das HF-Lade-Skript (MLDR.py) wird von neueren
`datasets`-Versionen nicht mehr unterstützt -- wir umgehen es und streamen die
JSONL-Dateien direkt über den generischen `json`-Loader.

- Korpus-Dokumente werden als .md nach data/documents/ geschrieben (laufen dann durch
  denselben Docling -> Chunk-Pfad wie echte Dokumente).
- data/ground_truth.yaml wird mit Dokument-Level-Relevanz erzeugt (query -> relevante
  Dokumente); MLDR hat keine Seiten-Labels.

Verwendung:
    python load_mldr.py --queries 50 --distractors 200
"""

from __future__ import annotations

import argparse
import re

import yaml

import config

LANG = "de"
HF_REPO = "Shitao/MLDR"
BASE_URL = f"https://huggingface.co/datasets/{HF_REPO}/resolve/main/mldr-v1.0-{LANG}"


def _safe(docid: str) -> str:
    return re.sub(r"[^A-Za-z0-9._-]", "_", str(docid))[:120]


def _as_markdown(text: str) -> str:
    """Erste Zeile zur H1-Überschrift machen -> Datei beginnt mit ``# ``.

    Nebeneffekt (der eigentliche Grund): Docling rät das Format aus den Magic-Bytes
    des *Inhalts*, bevor die ``.md``-Endung zählt. Prosa, die zufällig mit "BM"
    (BMP-Signatur), "PK", "%PDF" oder "<" beginnt, wird sonst als Bild/Zip/PDF/HTML
    fehlgedeutet und die Konvertierung stirbt. Ein führendes ``# `` (0x23 0x20) matcht
    keine Binär-Signatur -> Fallback auf die Endung -> Markdown-Backend. Die H1 ist
    zugleich echter Kontext für den HybridChunker (Heading-Serialisierung)."""
    text = text.strip()
    if not text:
        return "# (leer)\n"
    first, _, rest = text.partition("\n")
    body = rest.strip("\n")
    heading = f"# {first.strip()}\n"
    return f"{heading}\n{body}\n" if body else heading


def _stream(data_file: str):
    """Streamt eine (evtl. gz-komprimierte) JSONL-Datei ohne Voll-Download."""
    from datasets import load_dataset

    return load_dataset("json", data_files=data_file, split="train", streaming=True)


def main() -> None:
    parser = argparse.ArgumentParser(description="MLDR-Sample ins Harness-Format laden.")
    parser.add_argument("--queries", type=int, default=50, help="Anzahl Fragen.")
    parser.add_argument("--distractors", type=int, default=200, help="Zusätzliche Korpus-Docs.")
    parser.add_argument("--split", default="dev", help="Query-Split (dev/test/train).")
    args = parser.parse_args()

    # 1) Fragen + zugehörige (positive) Dokumente aus dem Query-Split
    docs: dict[str, str] = {}  # docid -> text
    need_text: set[str] = set()  # positive docids ohne eingebetteten Text
    questions: list[dict] = []
    for i, row in enumerate(_stream(f"{BASE_URL}/{args.split}.jsonl.gz")):
        if i >= args.queries:
            break
        positive_ids: list[str] = []
        for passage in row.get("positive_passages", []):
            docid = passage["docid"]
            positive_ids.append(docid)
            if passage.get("text"):
                docs[docid] = passage["text"]
            else:
                need_text.add(docid)
        questions.append({"query": row["query"], "_pos": positive_ids})

    # 2) Ein Korpus-Durchlauf: fehlende Positive-Texte auffüllen + Distraktoren sammeln
    if need_text or args.distractors > 0:
        distractors_added = 0
        for row in _stream(f"{BASE_URL}/corpus.jsonl.gz"):
            docid = row["docid"]
            if docid in need_text:
                docs[docid] = row["text"]
                need_text.discard(docid)
            elif distractors_added < args.distractors and docid not in docs:
                docs[docid] = row["text"]
                distractors_added += 1
            if not need_text and distractors_added >= args.distractors:
                break

    # 3) Dokumente als .md schreiben, altes Sample vorher aufräumen
    config.DOCS_DIR.mkdir(parents=True, exist_ok=True)
    for stale in config.DOCS_DIR.glob("*.md"):
        stale.unlink()

    filename: dict[str, str] = {}
    for docid, text in docs.items():
        name = _safe(docid) + ".md"
        filename[docid] = name
        (config.DOCS_DIR / name).write_text(_as_markdown(text), encoding="utf-8")

    # 4) Ground Truth (Dokument-Level)
    ground_truth = {
        "questions": [
            {"query": q["query"], "documents": [filename[d] for d in q["_pos"]]}
            for q in questions
        ]
    }
    config.GROUND_TRUTH.write_text(
        yaml.safe_dump(ground_truth, allow_unicode=True, sort_keys=False),
        encoding="utf-8",
    )

    print(f"{len(docs)} Dokumente  -> {config.DOCS_DIR}")
    print(f"{len(questions)} Fragen  -> {config.GROUND_TRUTH}")


if __name__ == "__main__":
    main()
