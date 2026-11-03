"""GET /me/organization-contacts — Landing Zone contact cards (CO + Org admin)."""

from __future__ import annotations

import asyncio

from fastapi import APIRouter, Depends

from ai_trust_authorization import get_current_user, openfga_client
from ai_trust_logging import get_logger
from app.keycloak import admin_client, current_realm
from app.schemas import OrganizationContact, OrganizationContactsResponse

router = APIRouter(tags=["organization"])
logger = get_logger(__name__)


async def _first_contact_for_role(
    role_name: str, realm: str
) -> OrganizationContact | None:
    """Return the alphabetically-first member of role_name as a contact card, or None."""
    members = await openfga_client.read_role_members(f"role:{role_name}")
    usernames = sorted(m.removeprefix("user:") for m in members)
    for username in usernames:

        def _fetch(u: str = username) -> dict | None:
            try:
                with admin_client(realm) as kc:
                    resp = kc.get("/users", params={"username": u, "exact": "true"})
                    resp.raise_for_status()
                    users = resp.json()
                return users[0] if users else None
            except Exception:
                logger.warning(
                    "organization.contact_fetch_failed",
                    extra={"role": role_name, "username": u},
                )
                return None

        u = await asyncio.to_thread(_fetch)
        if u:
            return OrganizationContact(
                username=u.get("username", ""),
                firstName=u.get("firstName", ""),
                lastName=u.get("lastName", ""),
                email=u.get("email", ""),
            )
    return None


@router.get("/me/organization-contacts", response_model=OrganizationContactsResponse)
async def my_organization_contacts(
    _user: str = Depends(get_current_user),
) -> OrganizationContactsResponse:
    realm = current_realm()
    co, admin = await asyncio.gather(
        _first_contact_for_role("ai_compliance_officer", realm),
        _first_contact_for_role("platform_administrator", realm),
    )
    return OrganizationContactsResponse(
        compliance_officer=co,
        organization_admin=admin,
    )
