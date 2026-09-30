"""Lädt XQuAD (Span-QA) ins Harness-Format -- der passagen-genaue Mechanik-Datensatz.

XQuAD sind 1.190 QA-Paare aus SQuAD-1.1-dev, professionell in 11 Sprachen übersetzt
(parallel, darunter Deutsch). Anders als MLDR (nur Dokument-Level-Relevanz) trägt jedes
Beispiel den **Antwort-Span** -- damit lässt sich passagen-genau messen (AK 3/4/6): wird
die *richtige Stelle* gefunden, nicht nur das richtige Dokument?

Aufbau:
- SQuAD/XQuAD-Kontexte sind einzelne Absätze; mehrere Fragen teilen sich einen Kontext.
- Wir **bündeln** mehrere (deduplizierte) Kontexte zu je einem längeren Dokument --
  Gold-Kontext + Distraktor-Kontexte --, damit der Link-/Präzisionstest nicht trivial ist
  (ein Absatz pro Datei wäre zu leicht: dann wäre "richtiges Dokument" == "richtige Stelle").
- Ground Truth pro Frage: `document` (die .md-Datei mit dem Gold-Kontext) + `answer_substring`
  (der Gold-Antworttext). `evaluate.is_relevant` zählt einen Treffer nur, wenn der Chunk aus
  dem richtigen Dokument stammt UND den Antworttext enthält -- also passagen-genau.

Anders als MLDR (dessen HF-Lade-Skript in `datasets` 3.x tot ist) ist XQuAD
"auto-converted to Parquet", also lädt der normale config-basierte Aufruf ohne Skript. Der
Datensatz ist winzig (1.190 Zeilen -> ein Download), das per-Dokument-429-Problem von MLDR
tritt hier nicht auf.

Verwendung:
    python load_xquad.py --queries 200 --distractors 800 --lang de --contexts-per-doc 6
"""

from __future__ import annotations

import argparse

import yaml

import config

HF_REPO = "google/xquad"


def _as_markdown(doc_index: int, contexts: list[str]) -> str:
    """Ein gebündeltes Dokument als Markdown serialisieren.

    Führendes ``# `` (Bytes ``23 20``) ist Absicht: Docling rät das Eingabeformat aus den
    Magic-Bytes des *Inhalts*, bevor die ``.md``-Endung zählt. Prosa, die zufällig mit "BM"
    (BMP), "PK", "%PDF" oder "<" beginnt, würde sonst an ein Binär-Backend geleitet und die
    Konvertierung stürbe. Ein H1 matcht keine Binär-Signatur -> Fallback auf die Endung ->
    Markdown-Backend. Die ``## Abschnitt``-Überschriften geben dem HybridChunker zugleich eine
    Struktur (Heading-Pfad = Provenance-Anker, den wir als Präzision@1 messen)."""
    parts = [f"# Sammlung {doc_index}\n"]
    for section, ctx in enumerate(contexts, start=1):
        parts.append(f"## Abschnitt {section}\n\n{ctx.strip()}\n")
    return "\n".join(parts)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="XQuAD-Sample ins Harness-Format laden."
    )
    parser.add_argument("--queries", type=int, default=200, help="Anzahl Fragen.")
    parser.add_argument(
        "--distractors",
        type=int,
        default=800,
        help="Zusätzliche Distraktor-Kontexte (über die Gold-Kontexte hinaus).",
    )
    parser.add_argument(
        "--lang", default="de", help="XQuAD-Sprache (de, es, el, ru, tr, ...)."
    )
    parser.add_argument(
        "--contexts-per-doc",
        type=int,
        default=6,
        help="Kontexte je gebündeltem Dokument (Gold + Distraktoren gemischt).",
    )
    args = parser.parse_args()

    from datasets import load_dataset

    rows = list(load_dataset(HF_REPO, f"xquad.{args.lang}", split="validation"))

    # 1) Kontexte deduplizieren, Erst-Sicht-Reihenfolge bewahren.
    context_index: dict[str, int] = {}
    ordered_contexts: list[str] = []
    for row in rows:
        ctx = row["context"]
        if ctx not in context_index:
            context_index[ctx] = len(ordered_contexts)
            ordered_contexts.append(ctx)

    # 2) Fragen gleichmäßig über den Datensatz verteilen, damit die Gold-Passagen über
    #    den ganzen Korpus streuen: XQuAD-Zeilen sind nach Kontext gruppiert, die ersten N
    #    Fragen lägen sonst alle in den ersten paar gebündelten Dokumenten. Ein Stride über
    #    die beantwortbaren Zeilen verteilt die Gold-Kontexte über viele Dokumente.
    answerable = [
        row
        for row in rows
        if row["answers"]["text"] and row["answers"]["text"][0].strip()
    ]
    n = min(args.queries, len(answerable))
    stride = max(1, len(answerable) // n)
    questions: list[dict] = []
    gold_ctx: set[int] = set()
    for row in answerable[::stride][:n]:
        ci = context_index[row["context"]]
        gold_ctx.add(ci)
        questions.append(
            {
                "query": row["question"].strip(),
                "_ctx": ci,
                "answer": row["answers"]["text"][0].strip(),
            }
        )

    # 3) Korpus = Gold-Kontexte + Distraktor-Kontexte (bis zum Budget), in Ordnung.
    corpus_ctx: list[int] = []
    distractors_added = 0
    for ci in range(len(ordered_contexts)):
        if ci in gold_ctx:
            corpus_ctx.append(ci)
        elif distractors_added < args.distractors:
            corpus_ctx.append(ci)
            distractors_added += 1

    # 4) Kontexte zu Dokumenten bündeln; jeder Kontext -> sein Dokument-Dateiname.
    doc_of_ctx: dict[int, str] = {}
    documents: dict[str, list[str]] = {}
    for position, ci in enumerate(corpus_ctx):
        doc_index = position // args.contexts_per_doc
        name = f"xquad-{args.lang}-doc-{doc_index:04d}.md"
        doc_of_ctx[ci] = name
        documents.setdefault(name, []).append(ordered_contexts[ci])

    # 5) Dokumente schreiben, altes Sample vorher aufräumen.
    config.DOCS_DIR.mkdir(parents=True, exist_ok=True)
    for stale in config.DOCS_DIR.glob("*.md"):
        stale.unlink()
    for name, contexts in documents.items():
        doc_index = int(name.rsplit("-", 1)[1].removesuffix(".md"))
        (config.DOCS_DIR / name).write_text(
            _as_markdown(doc_index, contexts), encoding="utf-8"
        )

    # 6) Ground Truth (Passagen-Level): document + answer_substring.
    ground_truth = {
        "questions": [
            {
                "query": q["query"],
                "document": doc_of_ctx[q["_ctx"]],
                "answer_substring": q["answer"],
            }
            for q in questions
        ]
    }
    config.GROUND_TRUTH.write_text(
        yaml.safe_dump(ground_truth, allow_unicode=True, sort_keys=False),
        encoding="utf-8",
    )

    print(
        f"{len(documents)} Dokumente ({len(corpus_ctx)} Kontexte)  -> {config.DOCS_DIR}"
    )
    print(f"{len(questions)} Fragen (Passagen-Level)  -> {config.GROUND_TRUTH}")


if __name__ == "__main__":
    main()
