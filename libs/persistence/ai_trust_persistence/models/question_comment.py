from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from ai_trust_persistence.database import Base


class QuestionComment(Base):
    """A comment on a single questionnaire question of an AI system's assessment.

    Supports the per-question comment thread in the single-page assessment UI:
    multiple comments per question, shown chronologically. A comment is also the
    vehicle for the mandatory-comment-on-change rule — changing an AI pre-filled
    answer requires a new comment before the question can be confirmed.

    Soft-deleted via ``deleted_at`` so the thread history is preserved; a comment
    author may delete their own comment and the system owner may delete any.
    Scoped per assessment cycle (``assessment_id``; see ``QuestionState``).
    """

    __tablename__ = "question_comments"

    id: Mapped[str] = mapped_column(String(20), primary_key=True)
    # The assessment cycle this comment belongs to (per-cycle, like QuestionState).
    assessment_id: Mapped[str] = mapped_column(
        String(30),
        ForeignKey("assessments.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    system_id: Mapped[str] = mapped_column(
        String(20),
        ForeignKey("ai_systems.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    question_key: Mapped[str] = mapped_column(String(100), nullable=False, index=True)

    author_username: Mapped[str] = mapped_column(String(200), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    # Soft delete — null ⇒ visible.
    deleted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
