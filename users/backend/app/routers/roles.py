from fastapi import APIRouter

from ai_trust_authorization.constants import BUILT_IN_ROLES
from app.keycloak import admin_client
from app.schemas import RoleSummary

router = APIRouter(prefix="/roles", tags=["roles"])

MANAGED_ROLES = set(BUILT_IN_ROLES)


@router.get("", response_model=list[RoleSummary])
def list_roles():
    with admin_client() as kc:
        resp = kc.get("/roles")
        resp.raise_for_status()
        return [
            RoleSummary(id=r["id"], name=r["name"], description=r.get("description", ""))
            for r in resp.json()
            if r["name"] in MANAGED_ROLES
        ]
