"""Prefixed ID generation for risk management entities.

Existing prefixes: ``RRM`` (RiskRegister), ``RSK`` (Risk), ``MIT`` (Mitigation).
Add new prefixes here when creating new models.
"""
from __future__ import annotations

import uuid


def new_id(prefix: str) -> str:
    """Return an ID like ``RRM-3F2A1B4C`` — prefix + 8 uppercase hex chars."""
    return f"{prefix}-{uuid.uuid4().hex[:8].upper()}"
