"""FastAPI authorization dependency.

`require_permission("evidence:approve")` returns a dependency that:
  1. Reads the authenticated username from the X-Forwarded-User header
     (set by oauth2-proxy, stripped-and-reset so it cannot be spoofed).
  2. Calls OpenFGA to check user:<name> has the mapped relation on platform:global.
  3. Returns 403 "Permission denied" on denial — never leaks object existence.

Fail-closed: any error reaching OpenFGA (down, misconfigured, timeout) results
in 403, never an open door.
"""
import logging

from fastapi import Depends, Request
from fastapi.exceptions import HTTPException

from ai_trust_authorization import openfga_client
from ai_trust_authorization.constants import PLATFORM_OBJECT, RELATION_BY_PERMISSION

log = logging.getLogger(__name__)

# oauth2-proxy sets X-Forwarded-User to the OIDC `sub` claim, which Keycloak
# renders as an opaque UUID. Our identity model (OpenFGA `user:<name>` tuples,
# the Keycloak Admin user list) is keyed on the human username, so we prefer
# X-Forwarded-Preferred-Username (the `preferred_username` claim) and only fall
# back to X-Forwarded-User when it is absent.
PREFERRED_USERNAME_HEADER = "x-forwarded-preferred-username"
USER_HEADER = "x-forwarded-user"


def get_current_user(request: Request) -> str:
    """Extract the authenticated username from the oauth2-proxy headers."""
    user = request.headers.get(PREFERRED_USERNAME_HEADER, "").strip()
    if not user:
        user = request.headers.get(USER_HEADER, "").strip()
    if not user:
        # No identity header means the request did not pass through oauth2-proxy,
        # or the proxy is misconfigured. Deny.
        log.warning("authz.missing_user_header")
        raise HTTPException(status_code=401, detail="Not authenticated")
    return user


async def check_permission(user: str, permission: str) -> bool:
    """Check a permission for a user, failing closed on any error."""
    relation = RELATION_BY_PERMISSION.get(permission)
    if relation is None:
        # Programmer error — an unknown permission string. Fail closed.
        log.error("authz.unknown_permission", extra={"permission": permission})
        return False
    try:
        return await openfga_client.check(f"user:{user}", relation, PLATFORM_OBJECT)
    except Exception:
        log.exception("authz.check_failed", extra={"user": user, "permission": permission})
        return False


def require_permission(permission: str):
    """Return a FastAPI dependency enforcing `permission` on the current user."""

    async def dependency(request: Request, user: str = Depends(get_current_user)) -> str:
        allowed = await check_permission(user, permission)
        if not allowed:
            log.warning(
                "authz.denied",
                extra={"user": user, "permission": permission, "path": request.url.path},
            )
            raise HTTPException(status_code=403, detail="Permission denied")
        return user

    return dependency
