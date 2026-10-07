"""Ask one question against the current EU AI Act index.

Public API:
    from app.rag import query
    answer, articles = query.ask("What are the obligations for high-risk AI systems?")
"""

from __future__ import annotations

import re

from . import index, llm_access

_INSTRUCTIONS = (
    "Answer using only the exact wording of the EU AI Act — do not paraphrase. "
    "For every claim, state the Article number (e.g. 'Article 50') explicitly. "
    "If quoting, reproduce the provision verbatim and name the Article."
)

_ARTICLE_RE = re.compile(r"Article\s+\d+[a-z]?(?:\(\d+\)(?:[a-z])?)*", re.IGNORECASE)


def ask(question: str) -> tuple[str, list[str]]:
    """Answer a question using the current index. Returns (answer, article_refs)."""
    meta = index.load_current()
    client = llm_access.make_client(storage_path=str(index.version_dir(meta["sha256"])))
    answer = client.chat(
        question,
        doc_id=meta["doc_id"],
        citations=True,
        instructions=_INSTRUCTIONS,
    )
    articles = sorted(set(_ARTICLE_RE.findall(answer)), key=_article_sort_key)
    return answer, articles


def _article_sort_key(ref: str) -> tuple[int, str]:
    m = re.search(r"(\d+)", ref)
    return (int(m.group(1)), ref) if m else (0, ref)
