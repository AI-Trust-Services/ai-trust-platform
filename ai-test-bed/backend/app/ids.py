"""Prefixed ID generation, matching the platform's ``SYS-XXXXXXXX`` convention.

Prefixes owned here: ``TBR`` (TestBedRun).
"""

from __future__ import annotations

import uuid


def new_id(prefix: str) -> str:
    """Return an ID like ``TBR-3F2A1B4C`` — prefix + 8 uppercase hex chars."""
    return f"{prefix}-{uuid.uuid4().hex[:8].upper()}"
