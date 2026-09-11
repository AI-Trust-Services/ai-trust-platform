"""Shared workflow ownership helpers.

Kept out of any single router so ownership logic lives in one place — both the
workflow router (assignment/sub-assignment flow) and the systems router (section
edit-lock) resolve a section's owner the same way.
"""
from __future__ import annotations

from ai_trust_persistence.models.ai_system import AISystem


def section_owner(row: AISystem, section: str) -> str | None:
    """The assignee that owns ``section`` (the person a sub-assignment is delegated
    from and returns to). ``"business"`` → business assignee, anything else →
    technical assignee."""
    return row.business_assignee_username if section == "business" else row.technical_assignee_username
