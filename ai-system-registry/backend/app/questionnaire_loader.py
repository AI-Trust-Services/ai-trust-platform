"""Locate ``ai-questionnaire.json`` (shared by the catalogue modules)."""

from __future__ import annotations

import pathlib

_HERE = pathlib.Path(__file__).resolve().parent


def find_questionnaire() -> pathlib.Path:
    """Works both in Docker (/app/context/prompts/…) and local dev (walk up to repo root)."""
    candidate = _HERE
    for _ in range(8):
        p = candidate / "context" / "prompts" / "ai-questionnaire.json"
        if p.exists():
            return p
        candidate = candidate.parent
    fallback = pathlib.Path("/app/context/prompts/ai-questionnaire.json")
    if fallback.exists():
        return fallback
    raise FileNotFoundError("ai-questionnaire.json not found")
