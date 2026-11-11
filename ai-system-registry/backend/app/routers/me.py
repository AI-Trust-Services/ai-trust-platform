"""Per-user Landing Zone endpoints — GET /me/open-tasks + GET /me/systems."""

from __future__ import annotations

from datetime import date, datetime
from typing import Optional

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel
from sqlalchemy import or_, select

from ai_trust_authorization import check_permission, require_permission
from ai_trust_authorization.constants import SYSTEMS_APPROVE, SYSTEMS_READ
from ai_trust_logging import get_logger
from ai_trust_persistence import SessionLocal
from ai_trust_persistence.models.ai_system import AISystem
from ai_trust_persistence.models.question_state import QuestionState
from app.questionnaire_required import QUESTION_LABEL

router = APIRouter(tags=["me"])
logger = get_logger(__name__)


class OpenTaskRow(BaseModel):
    """One actionable item for the current user on the Landing Zone.

    Two sources, same row shape:
      * **assigned** — a per-question delegation in the single-page assessment:
        a ``question_states`` row whose ``assignee_username`` is the user and
        that is not yet confirmed (``confirmed_at IS NULL``). ``assignment_id``
        carries the QuestionState id; ``question_key`` the question.
      * **review** — an AI system awaiting compliance review
        (``workflow_status == "pending_review"``), surfaced to the assigned
        ``compliance_officer_username`` if one is set, otherwise to every
        approver (``systems:approve`` holder) so an unassigned submitted
        assessment is never invisible. Carries ``tier`` + the two
        Art. 50 flags + ``planned_rollout_date`` for the CO landing's
        "Ready for review" table.

    (The pre-#358 ``required`` section-assignee source is gone: the single-page
    assessment replaced the two-phase business/technical workflow, so there is
    no section-pending state to derive it from. An owner's "complete the
    assessment" task is surfaced by the landing from ``/me/systems`` instead.)
    """

    source: str  # "assigned" | "review"
    system_id: str
    system_name: str
    system_version: str
    section: str  # "" for assigned, "review" for review (kept for frontend shape)
    workflow_status: Optional[str]
    question_key: str
    question_label: str
    assigned_at: datetime
    assigned_by_username: Optional[str] = None
    owner_username: Optional[str] = None
    assignment_id: Optional[str] = None
    tier: Optional[str] = None
    is_chatbot: Optional[bool] = None
    generates_synthetic_content: Optional[bool] = None
    planned_rollout_date: Optional[date] = None


def _current_user(request: Request) -> str:
    return request.headers.get("x-forwarded-preferred-username", "unknown")


@router.get(
    "/me/open-tasks",
    response_model=list[OpenTaskRow],
    dependencies=[Depends(require_permission(SYSTEMS_READ))],
)
async def my_open_tasks(request: Request) -> list[OpenTaskRow]:
    """Per-question assignments + compliance reviews open for the current user."""
    user = _current_user(request)
    tasks: list[OpenTaskRow] = []

    async with SessionLocal() as session:
        # Per-question delegations: question_states assigned to this user and not
        # yet confirmed (confirmed ⇒ done). One task per open question.
        assigned_rows = (
            await session.execute(
                select(
                    QuestionState,
                    AISystem.name,
                    AISystem.version,
                    AISystem.workflow_status,
                    AISystem.business_owners,
                )
                .join(AISystem, AISystem.id == QuestionState.system_id)
                .where(
                    QuestionState.assignee_username == user,
                    QuestionState.confirmed_at.is_(None),
                )
            )
        ).all()

        for (
            qs,
            system_name,
            system_version,
            workflow_status,
            business_owners,
        ) in assigned_rows:
            tasks.append(
                OpenTaskRow(
                    source="assigned",
                    system_id=qs.system_id,
                    system_name=system_name,
                    system_version=system_version,
                    section="",
                    workflow_status=workflow_status,
                    question_key=qs.question_key,
                    question_label=QUESTION_LABEL.get(qs.question_key, qs.question_key),
                    assigned_at=qs.assigned_at or qs.created_at,
                    assigned_by_username=qs.assigned_by_username,
                    owner_username=business_owners,
                    assignment_id=qs.id,
                )
            )

        # AI systems awaiting this user's compliance review. The CO is otherwise
        # invisible to Open Tasks (not a per-question assignee) — one row per
        # system currently in pending_review. A system with a specific CO
        # assigned surfaces only to that CO; a submitted assessment with NO CO
        # assigned surfaces to every approver (anyone holding systems:approve),
        # mirroring issue_classification, which lets any approver issue when the
        # CO field is empty — so a submitted review is never invisible.
        can_approve = await check_permission(user, SYSTEMS_APPROVE)
        review_conditions = [AISystem.compliance_officer_username == user]
        if can_approve:
            review_conditions.append(
                or_(
                    AISystem.compliance_officer_username.is_(None),
                    AISystem.compliance_officer_username == "",
                )
            )
        review_rows = (
            (
                await session.execute(
                    select(AISystem).where(
                        AISystem.workflow_status == "pending_review",
                        or_(*review_conditions),
                    )
                )
            )
            .scalars()
            .all()
        )

        for row in review_rows:
            tasks.append(
                OpenTaskRow(
                    source="review",
                    system_id=row.id,
                    system_name=row.name,
                    system_version=row.version,
                    section="review",
                    workflow_status=row.workflow_status,
                    question_key="assessment_review",
                    question_label=f"Review assessment: {row.name}",
                    assigned_at=row.updated_at or row.created_at,
                    assigned_by_username=row.business_owners,
                    owner_username=row.business_owners,
                    tier=row.tier,
                    is_chatbot=bool(row.is_chatbot),
                    generates_synthetic_content=bool(row.generates_synthetic_content),
                    planned_rollout_date=row.planned_rollout_date,
                )
            )

    tasks.sort(key=lambda t: t.assigned_at, reverse=True)
    return tasks


class MySystemRow(BaseModel):
    """One AI system where the user is the Owner (business_owners)."""

    id: str
    name: str
    tier: str
    workflow_status: str
    is_chatbot: bool
    generates_synthetic_content: bool
    business_owners: Optional[str] = None
    contributors: list[str] = []
    assignee_username: Optional[str] = None
    business_assignee_username: Optional[str] = None
    technical_assignee_username: Optional[str] = None
    compliance_officer_username: Optional[str] = None
    updated_at: Optional[datetime] = None
    created_at: Optional[datetime] = None


@router.get(
    "/me/systems",
    response_model=list[MySystemRow],
    dependencies=[Depends(require_permission(SYSTEMS_READ))],
)
async def my_systems(request: Request) -> list[MySystemRow]:
    """AI systems where the current user is the Owner (business_owners)."""
    user = _current_user(request)
    async with SessionLocal() as session:
        rows = (
            (
                await session.execute(
                    select(AISystem)
                    .where(AISystem.business_owners == user)
                    .order_by(AISystem.updated_at.desc().nullslast())
                )
            )
            .scalars()
            .all()
        )

    return [
        MySystemRow(
            id=row.id,
            name=row.name,
            tier=row.tier,
            workflow_status=row.workflow_status,
            is_chatbot=bool(row.is_chatbot),
            generates_synthetic_content=bool(row.generates_synthetic_content),
            business_owners=row.business_owners,
            contributors=list(row.contributors or []),
            assignee_username=row.assignee_username,
            business_assignee_username=row.business_assignee_username,
            technical_assignee_username=row.technical_assignee_username,
            compliance_officer_username=row.compliance_officer_username,
            updated_at=row.updated_at,
            created_at=row.created_at,
        )
        for row in rows
    ]
