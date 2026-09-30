"""Docling: Dokument -> strukturbewusste Chunks mit Provenance.

Wir speichern pro Chunk sowohl den Rohtext (für Anzeige / Substring-Match / BM25)
als auch die kontextualisierte Fassung (Heading-Pfad etc.), die ans Embedding-Modell
geht. Provenance (Seiten, Headings) reist mit, damit jede Passage später auf ihre
Fundstelle zurückführbar ist (Akzeptanzkriterium 6).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

from docling.chunking import HybridChunker
from docling.datamodel.base_models import ConversionStatus
from docling.document_converter import DocumentConverter

import config

SUPPORTED_SUFFIXES = {".pdf", ".docx", ".pptx", ".md", ".html", ".htm"}


@dataclass
class Chunk:
    id: str
    document: str  # Dateiname des Quelldokuments
    text: str  # Rohtext (Anzeige, Substring-Match, BM25)
    embed_text: str  # kontextualisierte Fassung für das Embedding
    pages: list[int] = field(default_factory=list)
    headings: list[str] = field(default_factory=list)


def _build_chunker(max_tokens: int) -> HybridChunker:
    """HybridChunker am BGE-M3-Tokenizer ausgerichtet.

    Die Chunker-API ist versionsabhängig; wir versuchen die aktuelle
    HuggingFaceTokenizer-Variante und fallen sonst auf die ältere Signatur zurück.

    Der Tokenizer wird **local_files_only zuerst** geladen: ist das Modell schon im
    HF-Cache (nach dem ersten Lauf immer), passiert kein Netzwerk-Call. Sonst würde
    `from_pretrained` bei *jedem* Aufruf HF anpingen -- was in Kombination mit dem
    früheren Per-Dokument-Aufbau die Hub-Rate-Limit-Sperre (HTTP 429) ausgelöst hat.
    """
    try:
        from docling_core.transforms.chunker.tokenizer.huggingface import (
            HuggingFaceTokenizer,
        )
        from transformers import AutoTokenizer

        try:
            hf_tokenizer = AutoTokenizer.from_pretrained(
                config.EMBED_MODEL, local_files_only=True
            )
        except Exception:  # noqa: BLE001 -- erster Lauf: Modell noch nicht im Cache
            hf_tokenizer = AutoTokenizer.from_pretrained(config.EMBED_MODEL)

        tokenizer = HuggingFaceTokenizer(tokenizer=hf_tokenizer, max_tokens=max_tokens)
        return HybridChunker(tokenizer=tokenizer)
    except ImportError:
        return HybridChunker(tokenizer=config.EMBED_MODEL, max_tokens=max_tokens)


def _pages(chunk) -> list[int]:
    pages: set[int] = set()
    meta = getattr(chunk, "meta", None)
    for item in getattr(meta, "doc_items", []) or []:
        for prov in getattr(item, "prov", []) or []:
            page_no = getattr(prov, "page_no", None)
            if page_no is not None:
                pages.add(int(page_no))
    return sorted(pages)


def parse_and_chunk(
    path: Path, converter: DocumentConverter, chunker: HybridChunker
) -> list[Chunk]:
    """Ein Dokument -> Chunks. `converter`/`chunker` werden vom Aufrufer **einmal**
    gebaut und wiederverwendet (kein teurer Neuaufbau + HF-Ping pro Datei)."""
    result = converter.convert(str(path), raises_on_error=False)
    if result.status not in (ConversionStatus.SUCCESS, ConversionStatus.PARTIAL_SUCCESS):
        # Eine kaputte Datei darf den ganzen Lauf nicht abbrechen -- aber laut warnen,
        # damit ein übersprungenes (evtl. relevantes) Dokument nicht still den Recall
        # verzerrt. Häufigste Ursache: Docling rät das Format aus den Magic-Bytes des
        # Inhalts und leitet Prosa fälschlich an ein Binär-Backend (Bild/Zip/PDF).
        print(f"  ! übersprungen ({result.status.value}): {path.name}")
        return []
    document = result.document

    chunks: list[Chunk] = []
    for i, ch in enumerate(chunker.chunk(document)):
        meta = getattr(ch, "meta", None)
        chunks.append(
            Chunk(
                id=f"{path.name}::{i}",
                document=path.name,
                text=ch.text,
                embed_text=chunker.contextualize(ch),
                pages=_pages(ch),
                headings=list(getattr(meta, "headings", []) or []),
            )
        )
    return chunks


def ingest_dir(docs_dir: Path, max_tokens: int) -> list[Chunk]:
    # Converter + Chunker einmal pro Chunk-Größe bauen und über alle Dokumente
    # wiederverwenden (statt pro Datei -- das war 1200x Tokenizer-Load + HF-Ping).
    converter = DocumentConverter()
    chunker = _build_chunker(max_tokens)
    chunks: list[Chunk] = []
    for path in sorted(docs_dir.glob("*")):
        if path.suffix.lower() in SUPPORTED_SUFFIXES:
            chunks.extend(parse_and_chunk(path, converter, chunker))
    return chunks
