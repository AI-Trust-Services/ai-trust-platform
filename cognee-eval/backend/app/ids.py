from __future__ import annotations

import uuid


def new_id(prefix: str) -> str:
    """Return an ID like ``EVL-3F2A1B4C``.

    Prefixes: ``EVL`` (Evaluation), ``EFB`` (EvaluationFeedback).
    """
    return f"{prefix}-{uuid.uuid4().hex[:8].upper()}"
