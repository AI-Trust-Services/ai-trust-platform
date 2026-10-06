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

import bisect
import os
import re
from dataclasses import dataclass, field
from pathlib import Path

EMBED_MODEL = os.environ.get("EMBED_MODEL", "intfloat/multilingual-e5-small")
CHUNK_MAX_TOKENS = int(os.environ.get("CHUNK_MAX_TOKENS", "512"))

SUPPORTED_SUFFIXES = {".pdf", ".docx", ".pptx", ".md", ".markdown", ".html", ".htm", ".txt"}

# Structured legal/standards texts (e.g. the EU AI Act) number their sections with a
# bare "Article N" heading that sits as a *sibling* of the section title at the same
# heading level. Docling keeps only the last same-level heading, so the chunker drops
# the number from a chunk's heading path — and a search for "Article 70" then finds
# nothing, because the identifier is absent from every indexed field. We detect these
# markers and re-attach them to each section's chunks (see _section_markers).
_SECTION_MARKER_RE = re.compile(r"^\s*(Article|Annex)\s+([0-9IVXLCDM]+)\b", re.IGNORECASE)
# self_ref of a body text item, e.g. "#/texts/1620" → 1620 (its reading-order index).
_TEXTS_REF_RE = re.compile(r"^#/texts/(\d+)$")


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
    from docling.datamodel.base_models import InputFormat
    from docling.datamodel.pipeline_options import (
        AcceleratorDevice,
        AcceleratorOptions,
        PdfPipelineOptions,
    )
    from docling.document_converter import DocumentConverter, PdfFormatOption

    opts = PdfPipelineOptions()
    # OCR (EasyOCR on CPU) dominates PDF parse time and is unnecessary for
    # digitally-born PDFs, which already carry a text layer. Off by default;
    # set INDEXING_DO_OCR=true to re-enable for scanned/image-only PDFs (a
    # scanned PDF with OCR off yields no text → the version fails with a clear
    # "no chunks" error rather than hanging).
    opts.do_ocr = os.environ.get("INDEXING_DO_OCR", "false").lower() == "true"
    opts.accelerator_options = AcceleratorOptions(
        num_threads=int(os.environ.get("DOCLING_NUM_THREADS", str(os.cpu_count() or 4))),
        device=AcceleratorDevice.CPU,
    )
    # Only the PDF pipeline is customised; other formats keep Docling defaults.
    return DocumentConverter(
        format_options={InputFormat.PDF: PdfFormatOption(pipeline_options=opts)}
    )


def build_chunker(max_tokens: int = CHUNK_MAX_TOKENS) -> "HybridChunker":
    """HybridChunker aligned to the embedding model's tokenizer, ``local_files_only`` first."""
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


def _section_markers(document) -> list[tuple[int, str]]:
    """Reading-order ``(index, label)`` list of ``Article N`` / ``Annex N`` markers.

    Docling emits these as ``section_header`` items at the same heading level as the
    section title, so the chunker keeps only the title and drops the number. We recover
    them from the document's text items so they can be re-attached to each section's
    chunks (see module docstring) — the index is the item's position in ``document.texts``,
    which matches the ``#/texts/N`` ``self_ref`` carried by every chunk's doc_items.
    """
    markers: list[tuple[int, str]] = []
    for i, item in enumerate(getattr(document, "texts", []) or []):
        if not str(getattr(item, "label", "")).endswith("section_header"):
            continue
        m = _SECTION_MARKER_RE.match(getattr(item, "text", "") or "")
        if m:
            # Normalise case + internal whitespace ("Article  70" → "Article 70").
            markers.append((i, f"{m.group(1).title()} {m.group(2).upper()}"))
    return markers


def _marker_for(
    chunk, marker_indices: list[int], markers: list[tuple[int, str]]
) -> str | None:
    """The nearest section marker at or before this chunk's first body item, or None."""
    if not markers:
        return None
    positions = [
        int(m.group(1))
        for item in getattr(getattr(chunk, "meta", None), "doc_items", []) or []
        if (m := _TEXTS_REF_RE.match(str(getattr(item, "self_ref", ""))))
    ]
    if not positions:
        return None
    pos = bisect.bisect_right(marker_indices, min(positions)) - 1
    return markers[pos][1] if pos >= 0 else None


def parse_and_chunk(path: Path, converter: "DocumentConverter", chunker: "HybridChunker") -> list[Chunk]:
    """One document → chunks. Raises on conversion failure so the caller can mark the
    version ``failed`` with a clear error (acceptance criterion 1, resilient)."""
    from docling.datamodel.base_models import ConversionStatus

    result = converter.convert(str(path), raises_on_error=False)
    if result.status not in (ConversionStatus.SUCCESS, ConversionStatus.PARTIAL_SUCCESS):
        raise ValueError(f"Docling conversion failed with status {result.status.value}")
    document = result.document
    markers = _section_markers(document)
    marker_indices = [idx for idx, _ in markers]

    chunks: list[Chunk] = []
    for i, ch in enumerate(chunker.chunk(document)):
        meta = getattr(ch, "meta", None)
        page, bboxes, self_ref = _provenance(ch)
        headings = list(getattr(meta, "headings", []) or [])
        embed_text = chunker.contextualize(ch)
        # Re-attach the section marker ("Article 70") the chunker dropped, so the
        # identifier is in both the embedding and the FTS column (built from embed_text).
        marker = _marker_for(ch, marker_indices, markers)
        if marker and marker not in headings:
            headings = [marker, *headings]
            embed_text = f"{marker}\n{embed_text}"
        chunks.append(
            Chunk(
                chunk_index=i,
                text=ch.text,
                embed_text=embed_text,
                page=page,
                bbox=bboxes,
                self_ref=self_ref,
                heading_path=headings,
            )
        )
    return chunks
