"""Read-only exposure of the external read-API bearer token for operators.

The token is a deploy-time secret (``EXTERNAL_API_TOKEN`` in the ``ai-trust-env``
secret). This endpoint lets a platform admin copy it from the UI to hand to the
team integrating an off-platform service, without needing cluster/kubectl
access. Read-only — the token is **not** generated or stored here (it lives in
the environment); rotating it means changing the secret and redeploying.

Admin-only (``iam:manage``), same gate as every other admin screen.
"""

from __future__ import annotations

import os

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from ai_trust_authorization.constants import IAM_MANAGE
from ai_trust_authorization.permissions import require_permission

router = APIRouter(prefix="/v1/external-api", tags=["external-api"])


class ExternalApiTokenResponse(BaseModel):
    configured: bool
    token: str | None = None
    service_principal: str


@router.get("/token", response_model=ExternalApiTokenResponse)
async def get_external_api_token(
    _: str = Depends(require_permission(IAM_MANAGE)),
) -> ExternalApiTokenResponse:
    token = os.environ.get("EXTERNAL_API_TOKEN", "").strip()
    return ExternalApiTokenResponse(
        configured=bool(token),
        token=token or None,
        service_principal=os.environ.get(
            "EXTERNAL_API_SERVICE_PRINCIPAL", "svc-external-api"
        ),
    )
