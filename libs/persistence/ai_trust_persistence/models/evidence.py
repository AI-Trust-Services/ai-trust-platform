from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import Column, Date, DateTime, ForeignKey, Integer, String, Table, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from ai_trust_persistence.database import Base

evidence_controls = Table(
    "evidence_controls",
    Base.metadata,
    Column("evidence_id", String(30), ForeignKey("evidence.id", ondelete="CASCADE"), primary_key=True),
    Column("control_id", String(30), ForeignKey("controls.id", ondelete="CASCADE"), primary_key=True),
)

evidence_obligations = Table(
    "evidence_obligations",
    Base.metadata,
    Column("evidence_id", String(30), ForeignKey("evidence.id", ondelete="CASCADE"), primary_key=True),
    Column("obligation_id", String(30), ForeignKey("obligations.id", ondelete="CASCADE"), primary_key=True),
)

evidence_ai_systems = Table(
    "evidence_ai_systems",
    Base.metadata,
    Column("evidence_id", String(30), ForeignKey("evidence.id", ondelete="CASCADE"), primary_key=True),
    Column("ai_system_id", String(20), ForeignKey("ai_systems.id", ondelete="CASCADE"), primary_key=True),
)

evidence_assessments = Table(
    "evidence_assessments",
    Base.metadata,
    Column("evidence_id", String(30), ForeignKey("evidence.id", ondelete="CASCADE"), primary_key=True),
    Column("assessment_id", String(30), ForeignKey("assessments.id", ondelete="CASCADE"), primary_key=True),
)


class Evidence(Base):
    """An artifact proving a control is implemented / an obligation fulfilled.

    Links to controls and obligations via the association tables above.
    Scope links to AI systems and assessments live in evidence_ai_systems
    and evidence_assessments (N:M) — no direct FK columns on this row.
    Approving evidence cascades to control effectiveness.
    """

    __tablename__ = "evidence"

    id: Mapped[str] = mapped_column(String(30), primary_key=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str] = mapped_column(Text, default="")
    evidence_type: Mapped[str] = mapped_column(String(50), default="document")
    status: Mapped[str] = mapped_column(String(30), default="pending", index=True)
    validity_from: Mapped[date | None] = mapped_column(Date, nullable=True)
    validity_until: Mapped[date | None] = mapped_column(Date, nullable=True)

    file_path: Mapped[str] = mapped_column(String(500), default="")
    file_name: Mapped[str] = mapped_column(String(300), default="")
    file_size: Mapped[int] = mapped_column(Integer, default=0)
    mime_type: Mapped[str] = mapped_column(String(100), default="")
    uploaded_by: Mapped[str] = mapped_column(String(200), default="")
    version_label: Mapped[str] = mapped_column(String(50), default="1.0")

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class EvidenceVersion(Base):
    """A snapshot of a previous version of an evidence item.

    When a new file is uploaded for an existing evidence item, the current
    file metadata is copied here before being replaced. The parent evidence
    row always reflects the current version; this table is the history log.
    """

    __tablename__ = "evidence_versions"

    id: Mapped[str] = mapped_column(String(30), primary_key=True)
    evidence_id: Mapped[str] = mapped_column(
        String(30), ForeignKey("evidence.id", ondelete="CASCADE"), nullable=False, index=True
    )
    version_label: Mapped[str] = mapped_column(String(50), nullable=False)
    file_path: Mapped[str] = mapped_column(String(500), default="")
    file_name: Mapped[str] = mapped_column(String(300), default="")
    file_size: Mapped[int] = mapped_column(Integer, default=0)
    mime_type: Mapped[str] = mapped_column(String(100), default="")
    uploaded_by: Mapped[str] = mapped_column(String(200), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
