from fastapi import APIRouter, Depends

from ai_trust_authorization import require_permission
from ai_trust_authorization.constants import BUILT_IN_ROLES
from app.schemas import RoleSummary

router = APIRouter(prefix="/roles", tags=["roles"])


@router.get("", response_model=list[RoleSummary])
def list_roles(_: str = Depends(require_permission("iam:manage"))):
    return [RoleSummary(id=name, name=name, description="") for name in BUILT_IN_ROLES]
