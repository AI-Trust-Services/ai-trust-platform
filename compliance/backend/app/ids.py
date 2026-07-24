"""Prefixed ID generation, matching the registry's ``SYS-XXXXXXXX`` convention."""
from __future__ import annotations

import uuid


def new_id(prefix: str) -> str:
    """Return an ID like ``ASS-3F2A1B4C`` — prefix + 8 uppercase hex chars.

    Existing prefixes: ``ASS`` (Assessment), ``OBL`` (Obligation),
    ``CTL`` (Control), ``EVD`` (Evidence), ``EVV`` (EvidenceVersion).
    Add new prefixes here when creating new models.
    """
    return f"{prefix}-{uuid.uuid4().hex[:8].upper()}"
