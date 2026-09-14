from __future__ import annotations

import httpx
from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert

from ai_trust_authorization.constants import IAM_MANAGE
from ai_trust_authorization.permissions import require_permission
from ai_trust_persistence.database import SessionLocal
from ai_trust_persistence.models.ai_provider_settings import AIProviderSetting
from ai_trust_logging import get_logger

from app.schemas import AiProviderSettings, AiProviderUpdate, TestConnectionResponse

logger = get_logger(__name__)

router = APIRouter(prefix="/v1/ai-provider", tags=["ai-provider"])

_OLLAMA_KEYS = ["llm_base_url", "llm_model", "llm_vision_model", "llm_api_key"]
_EXTERNAL_KEYS = [
    "ai_client_id", "ai_client_secret", "ai_auth_url", "ai_api_url",
    "ai_resource_group", "ai_deployment_id", "ai_api_version",
]
_SECRET_KEYS = {"llm_api_key", "ai_client_secret"}


async def _load_rows() -> dict[tuple[str, str], AIProviderSetting]:
    async with SessionLocal() as session:
        rows = (await session.execute(select(AIProviderSetting))).scalars().all()
    return {(r.provider, r.key): r for r in rows}


def _build_response(kv: dict[tuple[str, str], AIProviderSetting]) -> AiProviderSettings:
    active_provider = kv.get(("active", "provider"))
    active = active_provider.value if active_provider else "stub"

    def provider_dict(provider: str, keys: list[str]) -> dict[str, str | None]:
        result = {}
        for k in keys:
            row = kv.get((provider, k))
            if row is None:
                result[k] = None
            elif row.is_secret:
                result[k] = None  # masked; caller uses has_* flags
            else:
                result[k] = row.value
        return result

    return AiProviderSettings(
        active_provider=active,
        ollama=provider_dict("ollama", _OLLAMA_KEYS),
        external=provider_dict("external", _EXTERNAL_KEYS),
        has_ollama_api_key=bool(kv.get(("ollama", "llm_api_key")) and kv[("ollama", "llm_api_key")].value),
        has_external_client_secret=bool(
            kv.get(("external", "ai_client_secret")) and kv[("external", "ai_client_secret")].value
        ),
    )


@router.get("", response_model=AiProviderSettings)
async def get_ai_provider(_: str = Depends(require_permission(IAM_MANAGE))) -> AiProviderSettings:
    return _build_response(await _load_rows())


@router.put("", response_model=AiProviderSettings)
async def update_ai_provider(
    body: AiProviderUpdate,
    _: str = Depends(require_permission(IAM_MANAGE)),
) -> AiProviderSettings:
    async with SessionLocal() as session:
        existing = await _load_rows()

        # Upsert active provider row
        await session.execute(
            pg_insert(AIProviderSetting)
            .values(provider="active", key="provider", value=body.active_provider, is_secret=False)
            .on_conflict_do_update(
                index_elements=["provider", "key"],
                set_={"value": body.active_provider},
            )
        )

        # Upsert provider-specific settings
        for provider_name, keys, update_dict in [
            ("ollama", _OLLAMA_KEYS, body.ollama),
            ("external", _EXTERNAL_KEYS, body.external),
        ]:
            if update_dict is None:
                continue
            for k in keys:
                if k not in update_dict:
                    continue
                new_val = update_dict[k]
                is_secret = k in _SECRET_KEYS
                # For secrets: if new_val is None/empty, keep the existing value
                if is_secret and not new_val:
                    existing_row = existing.get((provider_name, k))
                    new_val = existing_row.value if existing_row else None
                await session.execute(
                    pg_insert(AIProviderSetting)
                    .values(provider=provider_name, key=k, value=new_val, is_secret=is_secret)
                    .on_conflict_do_update(
                        index_elements=["provider", "key"],
                        set_={"value": new_val, "is_secret": is_secret},
                    )
                )

        await session.commit()
        logger.info("admin.ai_provider.updated", extra={"active_provider": body.active_provider})

    return _build_response(await _load_rows())


@router.post("/test", response_model=TestConnectionResponse)
async def test_ai_provider(_: str = Depends(require_permission(IAM_MANAGE))) -> TestConnectionResponse:
    kv = await _load_rows()
    active_row = kv.get(("active", "provider"))
    active = active_row.value if active_row else "stub"

    if active == "stub":
        return TestConnectionResponse(success=True, message="Stub provider — no connection needed.")

    if active == "ollama":
        base_url_row = kv.get(("ollama", "llm_base_url"))
        base_url = (base_url_row.value or "").rstrip("/")
        # Strip /v1 suffix to get base Ollama URL, then ping /api/tags
        ping_url = base_url.removesuffix("/v1") + "/api/tags"
        try:
            async with httpx.AsyncClient(timeout=8) as client:
                resp = await client.get(ping_url)
            if resp.status_code < 400:
                return TestConnectionResponse(success=True, message=f"Ollama reachable at {base_url}.")
            return TestConnectionResponse(
                success=False, message=f"Ollama returned HTTP {resp.status_code}."
            )
        except httpx.ConnectError:
            return TestConnectionResponse(success=False, message=f"Connection refused — is Ollama running at {base_url}?")
        except (httpx.TimeoutException, TimeoutError):
            return TestConnectionResponse(success=False, message="Connection timed out — Ollama unreachable.")
        except Exception as exc:
            return TestConnectionResponse(success=False, message=f"Connection failed: {exc}")

    if active == "external":
        auth_url_row = kv.get(("external", "ai_auth_url"))
        client_id_row = kv.get(("external", "ai_client_id"))
        secret_row = kv.get(("external", "ai_client_secret"))
        auth_url = auth_url_row.value if auth_url_row else None
        client_id = client_id_row.value if client_id_row else None
        client_secret = secret_row.value if secret_row else None

        if not auth_url or not client_id or not client_secret:
            return TestConnectionResponse(
                success=False, message="OAuth Auth URL, Client ID, and Client Secret are required. Save settings first."
            )
        try:
            async with httpx.AsyncClient(timeout=15) as client:
                resp = await client.post(
                    auth_url,
                    data={"grant_type": "client_credentials"},
                    auth=(client_id, client_secret),
                )
            if resp.status_code == 200 and "access_token" in resp.json():
                return TestConnectionResponse(success=True, message="OAuth2 token fetched successfully — credentials are valid.")
            return TestConnectionResponse(
                success=False, message=f"Token endpoint returned HTTP {resp.status_code}."
            )
        except httpx.ConnectError:
            return TestConnectionResponse(success=False, message="Connection refused — check OAuth Auth URL.")
        except (httpx.TimeoutException, TimeoutError):
            return TestConnectionResponse(success=False, message="Connection timed out — OAuth Auth URL unreachable.")
        except Exception as exc:
            return TestConnectionResponse(success=False, message=f"Connection test failed: {exc}")

    return TestConnectionResponse(success=False, message=f"Unknown provider: {active}")
