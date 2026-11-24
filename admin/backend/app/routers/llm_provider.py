"""Bring-your-own-LLM provider configuration (issue #406).

Admin-only (``iam:manage``) CRUD + Test Connection + activation for a per-tenant
OpenAI-compatible LLM endpoint. Mirrors the SMTP router's conventions: single-row
table, token stored but never returned (only ``has_token``), token preserved on
PUT when omitted. Config changes are recorded in the audit log.

Activation is gated: a config must pass a live Test Connection probe before it can
be activated. "Restore the platform default" = deactivate the row (workflows fall
back to the Thalamus env default). There is no silent fallback at request time.
"""

from __future__ import annotations

from datetime import datetime, timezone
import os

import httpx
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select

from ai_trust_authorization.constants import IAM_MANAGE
from ai_trust_authorization.permissions import require_permission
from ai_trust_logging import get_logger
from ai_trust_persistence.audit import log_audit_event
from ai_trust_persistence.database import SessionLocal
from ai_trust_persistence.llm_config import validate_endpoint_url
from ai_trust_persistence.models.llm_provider_config import LLMProviderConfig

from app.schemas import (
    LLMProviderHealthResponse,
    LLMProviderResponse,
    LLMProviderTestRequest,
    LLMProviderTestResponse,
    LLMProviderUpdate,
)

logger = get_logger(__name__)

router = APIRouter(prefix="/v1/llm-provider", tags=["llm-provider"])

_RESOURCE = "llm_provider_config"


def _platform_default_live() -> bool:
    """True when the platform-default Thalamus is a real gateway (not stub/unset).

    When False and no BYO provider is active, AI workflows run in offline *stub*
    mode and return placeholder output — the admin UI warns about this so a real
    deployment doesn't silently serve non-meaningful AI results. Same env the
    registry client reads for its own stub decision.
    """
    base = os.environ.get("THALAMUS_BASE_URL", "").strip().lower()
    return base not in ("", "stub")


def _iso(dt: datetime | None) -> str | None:
    return dt.isoformat() if dt else None


def _to_response(row: LLMProviderConfig | None) -> LLMProviderResponse:
    if row is None:
        return LLMProviderResponse(
            base_url=None,
            model=None,
            has_token=False,
            is_active=False,
            last_test_status=None,
            last_test_message=None,
            last_tested_at=None,
            updated_at=None,
            updated_by=None,
            platform_default_live=_platform_default_live(),
        )
    return LLMProviderResponse(
        base_url=row.base_url,
        model=row.model,
        has_token=bool(row.api_token),
        is_active=row.is_active,
        last_test_status=row.last_test_status,
        last_test_message=row.last_test_message,
        last_tested_at=_iso(row.last_tested_at),
        updated_at=_iso(row.updated_at),
        updated_by=row.updated_by,
        platform_default_live=_platform_default_live(),
    )


async def _probe(base_url: str, api_token: str, model: str) -> tuple[bool, str]:
    """Send a minimal chat/completions request to verify auth + model + shape.

    Returns ``(ok, message)``. Distinguishes auth failure, missing model, and an
    incompatible (non-OpenAI-shaped) response from the actionable error messages
    the UI shows. Uses httpx directly (no openai SDK dependency in admin) and
    checks the response is OpenAI-compatible (``choices`` present).
    """
    url = base_url.rstrip("/") + "/chat/completions"
    headers = {
        "Authorization": f"Bearer {api_token}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": model,
        "messages": [{"role": "user", "content": "ping"}],
        "max_tokens": 1,
    }
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(url, headers=headers, json=payload)
    except (httpx.ConnectError, httpx.ConnectTimeout):
        return False, "Connection failed — check the endpoint URL."
    except httpx.TimeoutException:
        return False, "Connection timed out — the endpoint did not respond."
    except httpx.HTTPError as exc:
        return False, f"Connection failed: {exc}"

    if resp.status_code in (401, 403):
        return False, "Authentication failed — check the API token."
    if resp.status_code in (400, 404):
        return False, f"Model '{model}' is unavailable at this endpoint."
    if resp.status_code == 429:
        # Auth + model were accepted (those fail earlier); the provider is
        # rate-limiting or out of quota. The config itself is likely valid.
        return (
            False,
            "Rate limited by the provider (HTTP 429). The credentials look valid — "
            "check your plan's rate limit or quota, then retry.",
        )
    if resp.status_code >= 500:
        return False, f"Endpoint error (HTTP {resp.status_code})."
    if resp.status_code != 200:
        return False, f"Unexpected response (HTTP {resp.status_code})."

    # Compatibility: a well-formed OpenAI response is JSON with a 'choices' array.
    try:
        data = resp.json()
    except ValueError:
        return (
            False,
            "Endpoint responded but did not return JSON (not OpenAI-compatible).",
        )
    if not isinstance(data, dict) or not data.get("choices"):
        return False, "Endpoint responded but is not OpenAI-compatible (no 'choices')."
    return True, f"Connection OK — model '{model}' responded."


@router.get("", response_model=LLMProviderResponse)
async def get_llm_provider(
    _: str = Depends(require_permission(IAM_MANAGE)),
) -> LLMProviderResponse:
    async with SessionLocal() as session:
        row = await session.scalar(
            select(LLMProviderConfig).where(LLMProviderConfig.id == 1)
        )
        return _to_response(row)


@router.get("/health", response_model=LLMProviderHealthResponse)
async def llm_provider_health(
    _: str = Depends(require_permission(IAM_MANAGE)),
) -> LLMProviderHealthResponse:
    """Live liveness check of the ACTIVE provider, for the admin page to surface an
    active-but-broken state (misconfigured model / unreachable) on load.

    Read-only: unlike ``POST /test`` this neither writes ``last_test_status`` nor
    emits an audit event, so a page view doesn't churn status or spam the audit
    trail. Returns ``ok=None`` when no provider is active (nothing to probe).
    """
    async with SessionLocal() as session:
        row = await session.scalar(
            select(LLMProviderConfig).where(LLMProviderConfig.id == 1)
        )
    if row is None or not row.is_active:
        return LLMProviderHealthResponse(active=False, ok=None, message=None)
    if not (row.base_url and row.model and row.api_token):
        return LLMProviderHealthResponse(
            active=True, ok=False, message="Active provider is missing configuration."
        )
    reason = validate_endpoint_url(row.base_url)
    if reason:
        return LLMProviderHealthResponse(active=True, ok=False, message=reason)
    ok, message = await _probe(row.base_url, row.api_token, row.model)
    return LLMProviderHealthResponse(active=True, ok=ok, message=message)


@router.put("", response_model=LLMProviderResponse)
async def update_llm_provider(
    body: LLMProviderUpdate,
    username: str = Depends(require_permission(IAM_MANAGE)),
) -> LLMProviderResponse:
    # Validate the endpoint before persisting (SSRF guard). A null/blank URL is
    # allowed here (an admin may clear the config), so only validate when set.
    if body.base_url:
        reason = validate_endpoint_url(body.base_url)
        if reason:
            raise HTTPException(status_code=422, detail=reason)

    async with SessionLocal() as session:
        row = await session.scalar(
            select(LLMProviderConfig).where(LLMProviderConfig.id == 1)
        )
        if row is None:
            row = LLMProviderConfig(id=1)
            session.add(row)

        row.base_url = body.base_url or None
        row.model = body.model or None
        token_changed = False
        if body.api_token:
            row.api_token = body.api_token
            token_changed = True
        row.updated_by = username
        # Any config change invalidates a prior passing test and deactivates the
        # provider — activation must re-pass Test Connection.
        row.is_active = False
        row.last_test_status = None
        row.last_test_message = None
        row.last_tested_at = None

        log_audit_event(
            session,
            actor=username,
            action="llm_provider.updated",
            resource_type=_RESOURCE,
            resource_id="1",
            changes={
                "base_url": row.base_url,
                "model": row.model,
                "token_changed": token_changed,
            },
        )
        await session.commit()
        await session.refresh(row)
        logger.info("admin.llm_provider.updated", extra={"actor": username})
        return _to_response(row)


@router.post("/test", response_model=LLMProviderTestResponse)
async def test_llm_provider(
    body: LLMProviderTestRequest,
    username: str = Depends(require_permission(IAM_MANAGE)),
) -> LLMProviderTestResponse:
    # Resolve the candidate: request fields win, else fall back to the stored row
    # (so an admin can re-test the saved config, or test new values before save).
    async with SessionLocal() as session:
        row = await session.scalar(
            select(LLMProviderConfig).where(LLMProviderConfig.id == 1)
        )
        base_url = body.base_url or (row.base_url if row else None)
        model = body.model or (row.model if row else None)
        api_token = body.api_token or (row.api_token if row else None)

    if not base_url or not model or not api_token:
        return LLMProviderTestResponse(
            success=False,
            message="Endpoint URL, model, and API token are all required to test.",
        )
    reason = validate_endpoint_url(base_url)
    if reason:
        return LLMProviderTestResponse(success=False, message=reason)

    ok, message = await _probe(base_url, api_token, model)

    # Record the outcome against the stored row (if any) so the UI can show it and
    # activation can require a recent pass. Testing unsaved values doesn't create a
    # row; it only reports the result.
    async with SessionLocal() as session:
        row = await session.scalar(
            select(LLMProviderConfig).where(LLMProviderConfig.id == 1)
        )
        if row is not None:
            row.last_test_status = "ok" if ok else "failed"
            row.last_test_message = message
            row.last_tested_at = datetime.now(timezone.utc)
            log_audit_event(
                session,
                actor=username,
                action="llm_provider.tested",
                resource_type=_RESOURCE,
                resource_id="1",
                changes={"status": row.last_test_status},
            )
            await session.commit()
    logger.info("admin.llm_provider.tested", extra={"actor": username, "success": ok})
    return LLMProviderTestResponse(success=ok, message=message)


@router.post("/activate", response_model=LLMProviderResponse)
async def activate_llm_provider(
    username: str = Depends(require_permission(IAM_MANAGE)),
) -> LLMProviderResponse:
    async with SessionLocal() as session:
        row = await session.scalar(
            select(LLMProviderConfig).where(LLMProviderConfig.id == 1)
        )
        if row is None or not (row.base_url and row.model and row.api_token):
            raise HTTPException(
                status_code=422,
                detail="Configure the endpoint, model, and token before activating.",
            )
        # Activation requires a passing Test Connection (verify before go-live).
        if row.last_test_status != "ok":
            raise HTTPException(
                status_code=422,
                detail="Run a successful Test Connection before activating.",
            )
        # Re-validate the URL at activation (defense in depth).
        reason = validate_endpoint_url(row.base_url)
        if reason:
            raise HTTPException(status_code=422, detail=reason)

        row.is_active = True
        row.updated_by = username
        log_audit_event(
            session,
            actor=username,
            action="llm_provider.activated",
            resource_type=_RESOURCE,
            resource_id="1",
            changes={"base_url": row.base_url, "model": row.model},
        )
        await session.commit()
        await session.refresh(row)
        logger.info("admin.llm_provider.activated", extra={"actor": username})
        return _to_response(row)


@router.post("/deactivate", response_model=LLMProviderResponse)
async def deactivate_llm_provider(
    username: str = Depends(require_permission(IAM_MANAGE)),
) -> LLMProviderResponse:
    """Restore the platform default — workflows fall back to the Thalamus env config."""
    async with SessionLocal() as session:
        row = await session.scalar(
            select(LLMProviderConfig).where(LLMProviderConfig.id == 1)
        )
        if row is None:
            return _to_response(None)
        row.is_active = False
        row.updated_by = username
        log_audit_event(
            session,
            actor=username,
            action="llm_provider.deactivated",
            resource_type=_RESOURCE,
            resource_id="1",
            changes={},
        )
        await session.commit()
        await session.refresh(row)
        logger.info("admin.llm_provider.deactivated", extra={"actor": username})
        return _to_response(row)
