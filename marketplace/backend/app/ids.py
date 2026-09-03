"""Prefixed ID generation for the Marketplace backend."""
from __future__ import annotations

import uuid


def new_id(prefix: str) -> str:
    """Return an ID like ``MKT-3F2A1B4C`` — prefix + 8 uppercase hex chars."""
    return f"{prefix}-{uuid.uuid4().hex[:8].upper()}"
