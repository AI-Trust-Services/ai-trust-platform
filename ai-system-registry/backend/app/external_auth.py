"""Bearer-token auth for the external read API (``/v1/external/*``).

A single static shared secret from ``EXTERNAL_API_TOKEN``, presented as
``Authorization: Bearer <token>``. This is separate from the platform's
oauth2-proxy + OpenFGA model and is the only gate on the external surface. The
bearer scheme is a deliberate seam — the token is a shared secret today,
swappable for real OIDC/JWT validation later without changing the contract.

If ``EXTERNAL_API_TOKEN`` is unset the feature is treated as disabled (→ 503),
so the registry still starts normally in deployments that don't use it.
"""

import hmac
import os

from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

# auto_error=False so a missing credential is our 401 (HTTPBearer's own default
# is a 403).
_bearer = HTTPBearer(auto_error=False)


async def require_external_token(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> None:
    # Read at call time (not import) so startup never depends on it and it stays
    # testable regardless of import order. Strip whitespace to match what the
    # admin backend returns to the UI (common on secrets fed via kubectl
    # --from-literal or copy-pasted from YAML with trailing newlines).
    token = os.environ.get("EXTERNAL_API_TOKEN", "").strip()
    if not token:
        raise HTTPException(status_code=503, detail="External API is not configured")
    if (
        credentials is None
        or credentials.scheme.lower() != "bearer"
        or not hmac.compare_digest(credentials.credentials, token)
    ):
        raise HTTPException(
            status_code=401,
            detail="Invalid or missing bearer token",
            headers={"WWW-Authenticate": "Bearer"},
        )
