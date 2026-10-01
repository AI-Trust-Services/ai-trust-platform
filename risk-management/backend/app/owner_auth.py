"""Owner-gated approval for PlanTask/Incident: only the linked risk's
risk_owner (or, if unlinked, the item's assigned_to) may approve.

Identity in this platform is username-based (oauth2-proxy headers), but
risk_owner/assigned_to are free-text fields conventionally filled with an
email address. Resolve the caller's email server-side (never trust a
client-supplied email) via the same internal users-backend lookup used by
ai-system-registry's notification sender.
"""
from __future__ import annotations

import logging
import os

import httpx
from fastapi import HTTPException, Request

from ai_trust_authorization import get_current_user

log = logging.getLogger(__name__)

USERS_BACKEND_URL = os.environ.get("USERS_BACKEND_URL", "http://users-backend:8008")


async def _lookup_email(username: str) -> str | None:
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            resp = await client.post(
                f"{USERS_BACKEND_URL}/internal/users/email-lookup",
                json={"username": username},
            )
            resp.raise_for_status()
            return resp.json().get("email")
    except Exception:
        log.warning("owner_auth.email_lookup_failed", extra={"username": username})
        return None


def _norm(value: str | None) -> str:
    return (value or "").strip().lower()


async def _authorize_any(
    request: Request,
    candidates: list[str | None],
    *,
    none_set_detail: str,
    forbidden_detail: str,
) -> str:
    """Raise 403/422 unless the current user matches any candidate (by
    username or resolved email). Returns the current username on success."""
    username = get_current_user(request)
    valid = [c for c in candidates if c and c.strip()]
    if not valid:
        raise HTTPException(status_code=422, detail=none_set_detail)
    norm_candidates = {_norm(c) for c in valid}
    if _norm(username) in norm_candidates:
        return username
    email = await _lookup_email(username)
    if email and _norm(email) in norm_candidates:
        return username
    raise HTTPException(status_code=403, detail=forbidden_detail)


async def authorize_owner_action(request: Request, owner_value: str | None) -> str:
    """Raise 403/422 unless the current user is the designated owner.

    Matches by username or by email (resolved server-side), so both plain
    usernames and email addresses stored in risk_owner/assigned_to work.
    Returns the current username on success.
    """
    return await _authorize_any(
        request,
        [owner_value],
        none_set_detail="This item has no risk owner or assignee — set one before it can be approved.",
        forbidden_detail="Only the risk owner (or assignee) can approve this.",
    )


async def authorize_owner_or_reviewer_action(
    request: Request, owner_value: str | None, reviewer_value: str | None
) -> str:
    """Raise 403/422 unless the current user is the risk owner/assignee OR
    the register's reviewer. Used to gate confirming or cancelling a
    pending-delete proposal — anyone may propose, but only these two roles
    may act on the proposal.
    """
    return await _authorize_any(
        request,
        [owner_value, reviewer_value],
        none_set_detail=(
            "This item has no risk owner/assignee or reviewer set — "
            "set one before a deletion can be confirmed or cancelled."
        ),
        forbidden_detail="Only the risk owner or the register's reviewer can confirm or cancel this deletion.",
    )
