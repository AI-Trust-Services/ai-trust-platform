"""Assessment dossier snapshotting (issue #366).

Builds the immutable input/config/prompt snapshot captured at assessment start,
and writes the ``ai`` output layer once the prefill+classification pipeline
completes. All functions take the caller's session and never commit — the router
owns the transaction (repo convention).

The persistence layer is append-only (see
``libs/persistence/.../models/assessment_dossier.py`` + migration 0050): the
inputs row is INSERTed once and never mutated; each output layer is a separate
write-once row, so the AI layer here can never be overwritten by the
user-confirmed layer of #370.
"""

from __future__ import annotations

import hashlib
from functools import lru_cache
from pathlib import Path
from typing import Any

from ai_trust_logging import get_logger
from ai_trust_persistence.models.ai_system import AISystem
from ai_trust_persistence.models.assessment_dossier import (
    AssessmentDossier,
    AssessmentDossierOutput,
)
from ai_trust_persistence.models.document import Document, DocumentVersion
from app import classifier
from app.ids import new_id
from app.llm.templates import load_template
from app.questionnaire_loader import find_questionnaire
from app.questionnaire_pipeline import _evidence_fields
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert

logger = get_logger(__name__)

# The questionnaire + prompt files this run is driven by (same ids the pipeline
# and classifier use). Baked into the image under context/prompts/.
_QUESTIONNAIRE_ID = "ai-questionnaire"
_PREFILL_PROMPT_ID = "questionnaire_answer"
_CLASSIFY_PROMPT_ID = "classify_questionnaire"


def _sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


async def _snapshot_documents(session, system_id: str) -> list[dict[str, Any]]:
    """Freeze the documents that fed this run: the current + indexed version of
    each of the system's documents at assessment start.

    Only ``is_current`` AND ``status='indexed'`` versions are captured — exactly
    the set the RAG pipeline could retrieve. A document still processing (or
    failed) at open was not part of the run, so it is not in the snapshot (the UI
    also blocks starting an assessment while any doc is processing). Each entry
    pins the exact ``version_id``, so a later Replace (new version) never changes
    this frozen list, and the pinned original stays downloadable for audit — a
    hard delete of a referenced document is refused (see the indexing DELETE
    guard). This is the per-file version model from the #366 design: each file has
    its own lineage, and the snapshot is the cluster that pins which version each
    assessment used.
    """
    rows = (
        await session.execute(
            select(
                Document.id,
                Document.filename,
                DocumentVersion.id,
                DocumentVersion.version_label,
                DocumentVersion.minio_key,
                DocumentVersion.indexed_at,
            )
            .join(DocumentVersion, DocumentVersion.document_id == Document.id)
            .where(
                Document.ai_system_id == system_id,
                Document.deleted_at.is_(None),
                DocumentVersion.is_current.is_(True),
                DocumentVersion.status == "indexed",
            )
            .order_by(Document.created_at)
        )
    ).all()
    return [
        {
            "document_id": doc_id,
            "version_id": version_id,
            "version_label": version_label,
            "filename": filename,
            "minio_key": minio_key,
            "indexed_at": indexed_at.isoformat() if indexed_at else None,
        }
        for doc_id, filename, version_id, version_label, minio_key, indexed_at in rows
    ]


async def _build_input_snapshot(session, row: AISystem) -> dict[str, Any]:
    """Freeze the run's inputs: the registry relational evidence (verbatim) + the
    documents (pinned by version).

    ``system`` captures the full set of registry fields the pipeline feeds the LLM
    (``questionnaire_pipeline._evidence_fields`` — the single source of truth), not
    just name/description, so the dossier reflects exactly the relational data a run
    saw (#366). This is the versioning of relational registry data: each assessment
    freezes its own copy, independent of later edits to the live system row.
    """
    return {
        "system": {"id": row.id, **_evidence_fields(row)},
        "documents": await _snapshot_documents(session, row.id),
    }


@lru_cache(maxsize=1)
def _build_config_snapshot() -> dict[str, Any]:
    """Questionnaire + classification config, pinned by sha256. Static per deploy → cached.

    ``questionnaire`` is captured verbatim (+ sha256). ``classification`` is the
    risk/role classification logic — there is no separate config *file* today (the
    classifier is deterministic Python), so per the #366 design discussion it is a
    **version reference**: the classifier source pinned by sha256, a "list entry"
    (not embedded content). This pins the exact label/threshold logic a run used.
    **PM-open (#366):** if a dedicated classification config file is introduced,
    capture it here the same way the questionnaire is.
    """
    content = find_questionnaire().read_text(encoding="utf-8")
    classifier_src = Path(classifier.__file__).read_text(encoding="utf-8")
    return {
        "questionnaire": {
            "id": _QUESTIONNAIRE_ID,
            "sha256": _sha256(content),
            "content": content,
        },
        "classification": {
            "id": "classifier",
            "source": "ai-system-registry/backend/app/classifier.py",
            "sha256": _sha256(classifier_src),
        },
    }


@lru_cache(maxsize=1)
def _build_prompt_snapshot() -> dict[str, Any]:
    """Pre-fill + classification prompts, verbatim text + sha256. Cached."""
    prefill = load_template(_PREFILL_PROMPT_ID)
    classify = load_template(_CLASSIFY_PROMPT_ID)
    return {
        "prefill": {
            "id": _PREFILL_PROMPT_ID,
            "sha256": _sha256(prefill),
            "content": prefill,
        },
        "classification": {
            "id": _CLASSIFY_PROMPT_ID,
            "sha256": _sha256(classify),
            "content": classify,
        },
    }


async def create_dossier_in_session(session, row: AISystem, assessment_id: str) -> None:
    """INSERT the frozen-inputs dossier at assessment start (status derived).

    Idempotent: no-op if a dossier already exists for this assessment cycle
    (``assessment_id`` is unique). Never commits — the router owns the txn.
    """
    existing = (
        await session.execute(
            select(AssessmentDossier.id).where(
                AssessmentDossier.assessment_id == assessment_id
            )
        )
    ).scalar_one_or_none()
    if existing:
        return
    session.add(
        AssessmentDossier(
            id=new_id("DOS"),
            assessment_id=assessment_id,
            ai_system_id=row.id,
            inputs=await _build_input_snapshot(session, row),
            config_snapshot=_build_config_snapshot(),
            prompt_snapshot=_build_prompt_snapshot(),
        )
    )


async def write_ai_output_in_session(
    session,
    assessment_id: str,
    answers: list[dict[str, Any]],
    classification: dict[str, Any],
) -> None:
    """Append the ``ai`` output layer once the pipeline completes.

    Write-once: a second ``ai`` layer is dropped via ON CONFLICT DO NOTHING on
    ``UNIQUE(dossier_id, layer)`` (so a pipeline retry can't duplicate). No-op if
    the dossier is missing. Never commits — the caller owns the txn.
    """
    dossier_id = (
        await session.execute(
            select(AssessmentDossier.id).where(
                AssessmentDossier.assessment_id == assessment_id
            )
        )
    ).scalar_one_or_none()
    if not dossier_id:
        logger.warning(
            "assessment.dossier_missing_for_ai_output",
            extra={"assessment_id": assessment_id},
        )
        return
    stmt = (
        pg_insert(AssessmentDossierOutput.__table__)
        .values(
            id=new_id("DOO"),
            dossier_id=dossier_id,
            layer="ai",
            payload={"answers": answers, "classification": classification},
        )
        .on_conflict_do_nothing(constraint="uq_dossier_output_layer")
    )
    await session.execute(stmt)
