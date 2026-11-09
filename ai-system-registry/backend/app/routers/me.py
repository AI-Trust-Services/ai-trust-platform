"""Per-user Landing Zone endpoints — GET /me/open-tasks + GET /me/systems."""

from __future__ import annotations

from datetime import date, datetime
from typing import Optional

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel
from sqlalchemy import or_, select

from ai_trust_authorization import require_permission
from ai_trust_authorization.constants import SYSTEMS_READ
from ai_trust_logging import get_logger
from ai_trust_persistence import SessionLocal
from ai_trust_persistence.models.ai_system import AISystem
from ai_trust_persistence.models.assessment import Assessment
from ai_trust_persistence.models.question_assignment import QuestionAssignment
from app.questionnaire_required import (
    QUESTION_LABEL,
    missing_business_keys,
    missing_technical_keys,
)

router = APIRouter(tags=["me"])
logger = get_logger(__name__)


class OpenTaskRow(BaseModel):
    """One unanswered questionnaire question the user is responsible for.

    Two sources, same shape:
      * **required** — the question is required for the current section
        (business/technical) and still unanswered, and the user is the
        section-assignee while the workflow is in a state that expects that
        section (`business_pending`, `technical_pending`, or `info_requested`
        with the matching `info_requested_section`). The system cannot
        progress until these are filled.
      * **assigned** — an explicit per-question delegation via
        `POST /workflow/question-assign`. `assignment_id` and
        `assigned_by_username` are set.
    """

    source: str  # "required" | "assigned" | "review"
    system_id: str
    system_name: str
    system_version: str
    section: str  # business | technical | review
    workflow_status: Optional[str]
    question_key: str
    question_label: str
    assigned_at: datetime
    assigned_by_username: Optional[str] = None
    owner_username: Optional[str] = None
    assignment_id: Optional[str] = None
    # Populated for `review` rows only — the CO landing's "Ready for review"
    # table needs the system's EU AI Act tier (+ the two Art. 50 flags to
    # re-derive the stacked "Transparency Obligations" label) and planned
    # rollout date without a second join from the frontend.
    tier: Optional[str] = None
    is_chatbot: Optional[bool] = None
    generates_synthetic_content: Optional[bool] = None
    planned_rollout_date: Optional[date] = None


def _current_user(request: Request) -> str:
    return request.headers.get("x-forwarded-preferred-username", "unknown")


def _active_section(status: str, info_requested_section: str | None) -> str | None:
    """Return the section currently blocking progression, or None."""
    if status == "business_pending":
        return "business"
    if status == "technical_pending":
        return "technical"
    if status == "info_requested":
        return info_requested_section
    return None


@router.get(
    "/me/open-tasks",
    response_model=list[OpenTaskRow],
    dependencies=[Depends(require_permission(SYSTEMS_READ))],
)
async def my_open_tasks(request: Request) -> list[OpenTaskRow]:
    """Required + explicitly-assigned questions open for the current user."""
    user = _current_user(request)
    tasks: list[OpenTaskRow] = []

    async with SessionLocal() as session:
        # Required-but-unanswered questions on systems where this user is the
        # active section-assignee.
        system_rows = (
            (
                await session.execute(
                    select(AISystem).where(
                        or_(
                            AISystem.business_assignee_username == user,
                            AISystem.technical_assignee_username == user,
                        )
                    )
                )
            )
            .scalars()
            .all()
        )

        # Keys currently delegated to a per-question assignee. The
        # questionnaire disables these for the section-assignee, so they must
        # not surface as required owner-tasks (would duplicate the delegate's
        # assigned task and point to a locked question). Scoped to this user's
        # systems — a platform-wide scan would load every open delegation in
        # the org just to look up keys for these few systems.
        delegated_keys: dict[tuple[str, str], set[str]] = {}
        system_ids = [row.id for row in system_rows]
        if system_ids:
            delegation_rows = (
                await session.execute(
                    select(
                        QuestionAssignment.system_id,
                        QuestionAssignment.section,
                        QuestionAssignment.question_key,
                    ).where(
                        QuestionAssignment.answered_at.is_(None),
                        QuestionAssignment.system_id.in_(system_ids),
                    )
                )
            ).all()
            for sys_id, sec, key in delegation_rows:
                delegated_keys.setdefault((sys_id, sec), set()).add(key)

        for row in system_rows:
            section = _active_section(row.workflow_status, row.info_requested_section)
            if section == "business" and row.business_assignee_username == user:
                missing_keys = missing_business_keys(row)
            elif section == "technical" and row.technical_assignee_username == user:
                missing_keys = missing_technical_keys(row)
            else:
                continue
            delegated = delegated_keys.get((row.id, section), set())
            missing_keys = [k for k in missing_keys if k not in delegated]

            for key in missing_keys:
                tasks.append(
                    OpenTaskRow(
                        source="required",
                        system_id=row.id,
                        system_name=row.name,
                        system_version=row.version,
                        section=section,
                        workflow_status=row.workflow_status,
                        question_key=key,
                        question_label=QUESTION_LABEL.get(key, key),
                        assigned_at=row.updated_at or row.created_at,
                        assigned_by_username=row.business_owners or None,
                        owner_username=row.business_owners,
                    )
                )

        # Explicit per-question assignments. We filter on `answered_at IS NULL`
        # in SQL but still need the row's workflow state to decide whether the
        # section is actually editable — a lingering open assignment on a
        # section the workflow has already moved past is unactionable and
        # must not surface as a task.
        question_rows = (
            await session.execute(
                select(
                    QuestionAssignment,
                    AISystem.name,
                    AISystem.version,
                    AISystem.workflow_status,
                    AISystem.business_owners,
                    AISystem.info_requested_section,
                )
                .join(AISystem, AISystem.id == QuestionAssignment.system_id)
                .where(
                    QuestionAssignment.assignee_username == user,
                    QuestionAssignment.answered_at.is_(None),
                )
            )
        ).all()

        for (
            qa,
            system_name,
            system_version,
            workflow_status,
            business_owners,
            info_requested_section,
        ) in question_rows:
            # Suppress tasks for sections that are not currently editable:
            # only the active section (business_pending → business,
            # technical_pending → technical, info_requested → the bounced
            # section) can be answered. Any other workflow state locks the
            # whole questionnaire.
            if _active_section(workflow_status, info_requested_section) != qa.section:
                continue
            tasks.append(
                OpenTaskRow(
                    source="assigned",
                    system_id=qa.system_id,
                    system_name=system_name,
                    system_version=system_version,
                    section=qa.section,
                    workflow_status=workflow_status,
                    question_key=qa.question_key,
                    question_label=QUESTION_LABEL.get(qa.question_key, qa.question_key),
                    assigned_at=qa.assigned_at,
                    assigned_by_username=qa.assigned_by_username,
                    owner_username=business_owners,
                    assignment_id=qa.id,
                )
            )

        # Compliance assessments awaiting review by the current user when
        # assigned as the system's compliance officer. The CO is otherwise
        # invisible to Open Tasks since they are not a section-assignee and
        # cannot be a per-question delegate (separation of duties). One row
        # per assessment — a system can legitimately have several assessments
        # (e.g. an approved one plus a newer pending_review), and the overview
        # groups by assessment so each shows the right stage.
        review_rows = (
            await session.execute(
                select(
                    Assessment,
                    AISystem.name,
                    AISystem.version,
                    AISystem.workflow_status,
                    AISystem.business_owners,
                    AISystem.tier,
                    AISystem.is_chatbot,
                    AISystem.generates_synthetic_content,
                    AISystem.planned_rollout_date,
                )
                .join(AISystem, AISystem.id == Assessment.ai_system_id)
                .where(
                    AISystem.compliance_officer_username == user,
                    Assessment.status.in_(
                        ["submitted", "under_review", "pending_review"]
                    ),
                )
            )
        ).all()

        for (
            assessment,
            system_name,
            system_version,
            workflow_status,
            business_owners,
            tier,
            is_chatbot,
            generates_synthetic_content,
            planned_rollout_date,
        ) in review_rows:
            tasks.append(
                OpenTaskRow(
                    source="review",
                    system_id=assessment.ai_system_id,
                    system_name=system_name,
                    system_version=system_version,
                    section="review",
                    workflow_status=workflow_status,
                    question_key="assessment_review",
                    question_label=f"Review assessment: {assessment.title}",
                    assigned_at=assessment.updated_at or assessment.created_at,
                    assigned_by_username=business_owners,
                    owner_username=business_owners,
                    assignment_id=assessment.id,
                    tier=tier,
                    is_chatbot=bool(is_chatbot),
                    generates_synthetic_content=bool(generates_synthetic_content),
                    planned_rollout_date=planned_rollout_date,
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
