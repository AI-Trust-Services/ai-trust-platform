from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import DateTime, ForeignKey, String, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from ai_trust_persistence.database import Base


class AssessmentDossier(Base):
    """Immutable, append-only snapshot of one assessment run's INPUTS (EU AI Act).

    Issue #366. This row is INSERTed once at assessment start and **never updated
    or deleted** — a DB trigger rejects every UPDATE/DELETE (see migration 0050),
    so it is technically impossible to change a captured dossier, not merely
    detectable after the fact. It freezes exactly what went into a run, so an
    auditor can reconstruct "which inputs/configuration produced which outputs"
    independent of later edits to the live AISystem row, its documents, or the
    prompt/config files.

    1:1 with an assessment cycle (``assessment_id`` unique). The run's OUTPUTS are
    **not** stored here — they are append-only rows in
    ``AssessmentDossierOutput`` (one per layer), so no output write can ever touch
    this frozen row. "Run complete" is *derived* from the presence of an ``ai``
    output row, not a mutable status column (there is none, by design).

    FKs are ``RESTRICT``: an assessment/system that has a dossier cannot be
    deleted out from under it — the run's record is permanent. (TRUNCATE CASCADE,
    used by the test conftest, bypasses both the RESTRICT and the row trigger, so
    tests still reset cleanly.)

    The depth of ``inputs['documents']`` is PM-open (#366): reference+hash, the
    serialized text the LLM actually saw, or a byte-exact MinIO copy — the column
    shape does not change with that answer.
    """

    __tablename__ = "assessment_dossiers"

    id: Mapped[str] = mapped_column(String(30), primary_key=True)
    # The assessment cycle this dossier belongs to — 1:1 (unique).
    assessment_id: Mapped[str] = mapped_column(
        String(30),
        ForeignKey("assessments.id", ondelete="RESTRICT"),
        nullable=False,
        unique=True,
    )
    # Denormalized for "all dossiers for this system" lookups; not the scope key.
    ai_system_id: Mapped[str] = mapped_column(
        String(20),
        ForeignKey("ai_systems.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )

    # Frozen at assessment start; never mutated (DB-enforced append-only).
    # System name + description + linked documents (document depth is PM-open).
    inputs: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    # Questionnaire config + risk/role classification config, verbatim + sha256.
    config_snapshot: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    # Pre-fill prompt + classification prompt, verbatim text + sha256 ("version").
    prompt_snapshot: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class AssessmentDossierOutput(Base):
    """One append-only output layer of an assessment run (EU AI Act).

    Issue #366 writes the ``ai`` layer (pipeline per-question answers + proposed
    classification) once, at pipeline completion. Issue #370 (assignee
    luka-ratiani) writes the ``user_confirmed`` layer (owner-confirmed answers +
    final classification) once, on "Submit to Compliance Officer". A future
    ticket may add ``co_issued``.

    Append-only + write-once-per-layer: INSERTed once, never updated or deleted
    (DB trigger, migration 0050), and ``UNIQUE(dossier_id, layer)`` guarantees a
    layer cannot be written twice. This is *why* the AI layer can never be
    overwritten by the user-confirmed layer (#370's hard requirement): they are
    physically separate, immutable rows — not two fields on one mutable row.
    """

    __tablename__ = "assessment_dossier_outputs"
    __table_args__ = (
        UniqueConstraint("dossier_id", "layer", name="uq_dossier_output_layer"),
    )

    id: Mapped[str] = mapped_column(String(30), primary_key=True)
    dossier_id: Mapped[str] = mapped_column(
        String(30),
        ForeignKey("assessment_dossiers.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    # "ai" (#366) | "user_confirmed" (#370) | future "co_issued".
    layer: Mapped[str] = mapped_column(String(30), nullable=False)
    payload: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
