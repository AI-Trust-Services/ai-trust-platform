"""Prefixed ID generation, matching the platform's ``SYS-XXXXXXXX`` convention.

Mirrors ``compliance/backend/app/ids.py``. Prefixes owned here:
``DOC`` (Document), ``DOCV`` (DocumentVersion), ``CHNK`` (DocumentChunk).
"""

from __future__ import annotations

import uuid


def new_id(prefix: str) -> str:
    """Return an ID like ``DOC-3F2A1B4C`` — prefix + 8 uppercase hex chars."""
    return f"{prefix}-{uuid.uuid4().hex[:8].upper()}"
