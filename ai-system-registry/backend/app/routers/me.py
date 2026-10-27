"""Per-user Landing Zone endpoints — GET /me/open-tasks + GET /me/systems."""

from __future__ import annotations

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Request
from pydantic import BaseModel
from sqlalchemy import or_, select
from sqlalchemy.dialects.postgresql import JSONB

from ai_trust_logging import get_logger
from ai_trust_persistence import SessionLocal
from ai_trust_persistence.models.ai_system import AISystem
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

    source: str  # "required" | "assigned"
    system_id: str
    system_name: str
    section: str  # business | technical
    workflow_status: Optional[str]
    question_key: str
    question_label: str
    assigned_at: datetime
    assigned_by_username: Optional[str] = None
    assignment_id: Optional[str] = None


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


@router.get("/me/open-tasks", response_model=list[OpenTaskRow])
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

        for row in system_rows:
            section = _active_section(row.workflow_status, row.info_requested_section)
            if section == "business" and row.business_assignee_username == user:
                missing_keys = missing_business_keys(row)
            elif section == "technical" and row.technical_assignee_username == user:
                missing_keys = missing_technical_keys(row)
            else:
                continue

            for key in missing_keys:
                tasks.append(
                    OpenTaskRow(
                        source="required",
                        system_id=row.id,
                        system_name=row.name,
                        section=section,
                        workflow_status=row.workflow_status,
                        question_key=key,
                        question_label=QUESTION_LABEL.get(key, key),
                        assigned_at=row.updated_at or row.created_at,
                        assigned_by_username=row.business_owners or None,
                    )
                )

        # Explicit per-question assignments.
        question_rows = (
            await session.execute(
                select(QuestionAssignment, AISystem.name, AISystem.workflow_status)
                .join(AISystem, AISystem.id == QuestionAssignment.system_id)
                .where(
                    QuestionAssignment.assignee_username == user,
                    QuestionAssignment.answered_at.is_(None),
                )
            )
        ).all()

        for qa, system_name, workflow_status in question_rows:
            tasks.append(
                OpenTaskRow(
                    source="assigned",
                    system_id=qa.system_id,
                    system_name=system_name,
                    section=qa.section,
                    workflow_status=workflow_status,
                    question_key=qa.question_key,
                    question_label=QUESTION_LABEL.get(qa.question_key, qa.question_key),
                    assigned_at=qa.assigned_at,
                    assigned_by_username=qa.assigned_by_username,
                    assignment_id=qa.id,
                )
            )

    tasks.sort(key=lambda t: t.assigned_at, reverse=True)
    return tasks


class MySystemRow(BaseModel):
    """One AI system where the user is the Owner or in the Contributors list."""

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


@router.get("/me/systems", response_model=list[MySystemRow])
async def my_systems(request: Request) -> list[MySystemRow]:
    """AI systems where the current user is the Owner (business_owners) or in
    the Contributors list."""
    user = _current_user(request)
    async with SessionLocal() as session:
        rows = (
            (
                await session.execute(
                    select(AISystem)
                    .where(
                        or_(
                            AISystem.business_owners == user,
                            AISystem.contributors.cast(JSONB).contains([user]),
                        )
                    )
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
