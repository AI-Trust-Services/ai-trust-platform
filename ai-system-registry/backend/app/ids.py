"""Prefixed ID generation for the AI System Registry."""
from __future__ import annotations

import uuid


def new_id(prefix: str) -> str:
    """Return an ID like ``SYS-3F2A1B4C`` — prefix + 8 uppercase hex chars.

    Existing prefixes: ``SYS`` (AISystem), ``SWS`` (SystemWorkflowStep), ``MDL`` (ModelCard),
    ``NOTE`` (ReviewNote), ``SNOTE`` (SystemNote).
    Add new prefixes here when creating new models.
    """
    return f"{prefix}-{uuid.uuid4().hex[:8].upper()}"
