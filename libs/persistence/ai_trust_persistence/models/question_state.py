from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from ai_trust_persistence.database import Base


class QuestionState(Base):
    """Per-question review state for the single-page EU AI Act assessment.

    One row per questionnaire question that has been touched (AI-prefilled or
    edited) for a given AI system. Holds the review lifecycle the compliance
    officer relies on: whether the owner has *confirmed* the question
    (``confirmed_at``), whether the current answer is the AI's pre-fill or a
    manual change (``answer_source`` + ``ai_original_answer`` to detect a
    change), the per-question AI ``confidence`` band, and the per-question
    ``assignee`` (null ⇒ the system owner is the editor).

    Scoped per system (not per compliance ``Assessment``) — consistent with
    ``ai_systems.questionnaire_answers`` and the classification, which also live
    on the system row and are edited in place across re-assessments.
    """

    __tablename__ = "question_states"
    __table_args__ = (
        UniqueConstraint("system_id", "question_key", name="uq_question_state"),
    )

    id: Mapped[str] = mapped_column(String(20), primary_key=True)
    system_id: Mapped[str] = mapped_column(
        String(20),
        ForeignKey("ai_systems.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    question_key: Mapped[str] = mapped_column(String(100), nullable=False)

    # null ⇒ Incomplete; set ⇒ Complete. `confirmed_by` records WHO confirmed:
    # a question is "owner-confirmed" (the submit gate) only when confirmed_by is
    # the system owner. A contributor confirming their assigned question sets
    # confirmed_by to the contributor — progress, but not sufficient to submit.
    confirmed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    confirmed_by: Mapped[str | None] = mapped_column(String(200), nullable=True)

    # When the answer last changed from its previous saved value. The confirm
    # gate requires a justifying comment created at/after this instant when the
    # answer is a manual change from the AI pre-fill (audit: "why the override").
    answer_changed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # "ai_prefilled" until the owner/contributor changes the value → "manual".
    answer_source: Mapped[str] = mapped_column(String(20), default="ai_prefilled")
    # The AI's originally proposed value, retained to detect a change-from-AI
    # (which triggers the mandatory-comment gate before Confirm).
    ai_original_answer: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Per-question AI confidence band: "high" | "medium" | "low" (null if N/A).
    confidence: Mapped[str | None] = mapped_column(String(10), nullable=True)

    # Per-question assignment. null assignee ⇒ the system owner is the editor.
    assignee_username: Mapped[str | None] = mapped_column(String(200), nullable=True)
    assigned_by_username: Mapped[str | None] = mapped_column(String(200), nullable=True)
    assigned_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
