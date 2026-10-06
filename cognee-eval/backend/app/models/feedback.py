from datetime import datetime, timezone

from sqlalchemy import DateTime, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class Feedback(Base):
    __tablename__ = "feedback"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    evaluation_id: Mapped[str] = mapped_column(String, nullable=False, index=True)
    conclusion: Mapped[str] = mapped_column(Text, nullable=False)
    reasoning: Mapped[str] = mapped_column(Text, nullable=False)
    supporting_node_ids: Mapped[str] = mapped_column(Text, nullable=False, default="[]")  # JSON
    conditions: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String, nullable=False, default="pending")
    reviewer: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
    )
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
