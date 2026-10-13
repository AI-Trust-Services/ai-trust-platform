"""Citation utilities for the knowledge-grounded task agent.

Assigns stable, human-readable reference IDs to retrieved passages and provides
helpers to format them as a numbered block for the LLM context.

Reference-ID format
-------------------
Each ref_id is ``<prefix>-<identifier>`` where:

- Prefix is determined by the source label:
  - ``legal``               → ``L-``
  - ``reviewed_judgments``  → ``J-``
  - ``system_evidence``     → ``S-``
  - anything else           → ``X-``
- Identifier is the raw chunk_id / node_id from the passage metadata, or a
  zero-padded index when no unique ID is available.

Deduplication
-------------
If two passages produce the same ref_id, the second one is silently ignored
(first-writer wins).  This keeps the formatted block and the retrieved dict
stable across multiple tool calls with overlapping results.
"""

from __future__ import annotations

_PREFIX_MAP: dict[str, str] = {
    "legal": "L",
    "reviewed_judgments": "J",
    "system_evidence": "S",
}


def _make_prefix(source_label: str) -> str:
    return _PREFIX_MAP.get(source_label, "X")


def assign_ref_id(passage: dict, index: int) -> str:
    """Return a stable ref_id for *passage* at position *index*.

    Preference order:
    1. ``meta.chunk_id``  (classic RAG)
    2. ``meta.node_id``   (graph backend)
    3. Zero-padded *index*
    """
    meta = passage.get("meta", {})
    raw_id: str = (
        str(meta.get("chunk_id") or "").strip()
        or str(meta.get("node_id") or "").strip()
        or str(index).zfill(4)
    )
    prefix = _make_prefix(passage.get("source_label", ""))
    return f"{prefix}-{raw_id}"


def register_passages(
    retrieved: dict[str, dict],
    passages: list[dict],
) -> list[dict]:
    """Assign ref_ids to *passages* and insert them into *retrieved* (dedup).

    Returns the list of passages that were actually inserted (skips duplicates).
    Mutates *retrieved* in-place.
    """
    inserted: list[dict] = []
    for i, p in enumerate(passages):
        ref_id = assign_ref_id(p, i)
        if ref_id in retrieved:
            continue  # dedup
        enriched = {**p, "ref_id": ref_id}
        retrieved[ref_id] = enriched
        inserted.append(enriched)
    return inserted


def format_passage_block(passages: list[dict]) -> str:
    """Format a list of enriched passages (must have ``ref_id``) for the LLM.

    Returns a numbered Markdown block where each entry shows its ref_id and text.
    Returns an empty string when *passages* is empty.
    """
    if not passages:
        return ""

    lines: list[str] = []
    for passage in passages:
        ref_id = passage.get("ref_id", "?")
        text = passage.get("text", "")
        meta = passage.get("meta", {})
        src = meta.get("source", {})
        loc = ""
        if isinstance(src, dict) and src.get("filename"):
            loc = src["filename"]
            if src.get("page"):
                loc += f", p. {src['page']}"
        lines.append(f"[{ref_id}]" + (f" ({loc})" if loc else "") + f"\n{text}")

    return "\n\n".join(lines)
