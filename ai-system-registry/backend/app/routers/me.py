"""Per-user Landing Zone endpoints — currently just GET /me/open-tasks."""

from __future__ import annotations

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Request
from pydantic import BaseModel
from sqlalchemy import or_, select

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
