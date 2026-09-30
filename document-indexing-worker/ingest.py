"""Docling: document bytes → structure-aware chunks with provenance.

Ported from experiments/document-indexing/ingest.py and provenance_check.py. Per chunk
we keep the raw text (display / FTS), the contextualised text (heading path etc.) that
goes to the embedder, and provenance in BOTH forms so any passage traces back to its
source location (acceptance criterion 6):
  - PDF: page number + bounding box(es)
  - any format: structural anchor (self_ref) + heading path

The converter/chunker are built once and reused (building per document re-loads the
tokenizer and pings HF on every call — the Phase 1 rate-limit trap).
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

EMBED_MODEL = os.environ.get("EMBED_MODEL", "BAAI/bge-m3")
CHUNK_MAX_TOKENS = int(os.environ.get("CHUNK_MAX_TOKENS", "512"))

SUPPORTED_SUFFIXES = {".pdf", ".docx", ".pptx", ".md", ".markdown", ".html", ".htm", ".txt"}


@dataclass
class Chunk:
    chunk_index: int
    text: str
    embed_text: str
    page: int | None = None
    bbox: list[dict] = field(default_factory=list)
    self_ref: str | None = None
    heading_path: list[str] = field(default_factory=list)


def build_converter() -> "DocumentConverter":
    from docling.document_converter import DocumentConverter

    return DocumentConverter()


def build_chunker(max_tokens: int = CHUNK_MAX_TOKENS) -> "HybridChunker":
    """HybridChunker aligned to the BGE-M3 tokenizer, ``local_files_only`` first."""
    from docling.chunking import HybridChunker

    try:
        from docling_core.transforms.chunker.tokenizer.huggingface import (
            HuggingFaceTokenizer,
        )
        from transformers import AutoTokenizer

        try:
            hf_tokenizer = AutoTokenizer.from_pretrained(
                EMBED_MODEL, local_files_only=True
            )
        except Exception:  # noqa: BLE001 — first run: model not yet cached
            hf_tokenizer = AutoTokenizer.from_pretrained(EMBED_MODEL)

        tokenizer = HuggingFaceTokenizer(tokenizer=hf_tokenizer, max_tokens=max_tokens)
        return HybridChunker(tokenizer=tokenizer)
    except ImportError:
        return HybridChunker(tokenizer=EMBED_MODEL, max_tokens=max_tokens)


def _provenance(chunk) -> tuple[int | None, list[dict], str | None]:
    """First page, all bounding boxes, and the first structural anchor for a chunk."""
    pages: set[int] = set()
    bboxes: list[dict] = []
    self_ref: str | None = None
    meta = getattr(chunk, "meta", None)
    for item in getattr(meta, "doc_items", []) or []:
        if self_ref is None:
            self_ref = getattr(item, "self_ref", None)
        for prov in getattr(item, "prov", []) or []:
            page_no = getattr(prov, "page_no", None)
            if page_no is not None:
                pages.add(int(page_no))
            bbox = getattr(prov, "bbox", None)
            if bbox is not None:
                origin = getattr(getattr(bbox, "coord_origin", None), "value", None)
                bboxes.append(
                    {
                        "page": page_no,
                        "l": getattr(bbox, "l", None),
                        "t": getattr(bbox, "t", None),
                        "r": getattr(bbox, "r", None),
                        "b": getattr(bbox, "b", None),
                        # Docling PDFs report BOTTOMLEFT; the UI overlay must flip to top-left.
                        "origin": origin,
                    }
                )
    page = min(pages) if pages else None
    return page, bboxes, self_ref


def parse_and_chunk(path: Path, converter: "DocumentConverter", chunker: "HybridChunker") -> list[Chunk]:
    """One document → chunks. Raises on conversion failure so the caller can mark the
    version ``failed`` with a clear error (acceptance criterion 1, resilient)."""
    from docling.datamodel.base_models import ConversionStatus

    result = converter.convert(str(path), raises_on_error=False)
    if result.status not in (ConversionStatus.SUCCESS, ConversionStatus.PARTIAL_SUCCESS):
        raise ValueError(f"Docling conversion failed with status {result.status.value}")
    document = result.document

    chunks: list[Chunk] = []
    for i, ch in enumerate(chunker.chunk(document)):
        meta = getattr(ch, "meta", None)
        page, bboxes, self_ref = _provenance(ch)
        chunks.append(
            Chunk(
                chunk_index=i,
                text=ch.text,
                embed_text=chunker.contextualize(ch),
                page=page,
                bbox=bboxes,
                self_ref=self_ref,
                heading_path=list(getattr(meta, "headings", []) or []),
            )
        )
    return chunks
