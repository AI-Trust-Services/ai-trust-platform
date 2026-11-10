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
from typing import Any

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert

from ai_trust_logging import get_logger
from ai_trust_persistence.models.ai_system import AISystem
from ai_trust_persistence.models.assessment_dossier import (
    AssessmentDossier,
    AssessmentDossierOutput,
)

from app.ids import new_id
from app.llm.templates import load_template
from app.questionnaire_loader import find_questionnaire

logger = get_logger(__name__)

# The questionnaire + prompt files this run is driven by (same ids the pipeline
# and classifier use). Baked into the image under context/prompts/.
_QUESTIONNAIRE_ID = "ai-questionnaire"
_PREFILL_PROMPT_ID = "questionnaire_answer"
_CLASSIFY_PROMPT_ID = "classify_questionnaire"


def _sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _snapshot_documents(row: AISystem) -> list[dict[str, Any]]:
    """Freeze the linked documents at assessment start.

    **PM-OPEN (#366)** — the depth here is the one undecided question. The
    current safe minimum is the metadata already on the registry row (no extra
    I/O), a strict subset of every option, so it is never wrong. When the PM
    decides, ONLY this function changes (table, triggers, and call sites do not):
      - reference+hash  → add a sha256 of each document's MinIO bytes;
      - what the LLM saw → add the serialized extracted text/chunks;
      - byte-exact      → copy the MinIO object to a dossier-scoped key / pin its
                          object version.
    """
    return [
        {
            "filename": d.get("filename"),
            "minio_key": d.get("minio_key"),
            "uploaded_at": d.get("uploaded_at"),
        }
        for d in (row.registration_documents or [])
    ]


def _build_input_snapshot(row: AISystem) -> dict[str, Any]:
    return {
        "system": {
            "id": row.id,
            "name": row.name,
            "description": row.description,
        },
        "documents": _snapshot_documents(row),
    }


@lru_cache(maxsize=1)
def _build_config_snapshot() -> dict[str, Any]:
    """Questionnaire config, verbatim + sha256. Static per deploy → cached.

    ``classification`` is **PM-OPEN (#366)**: "risk & role classification
    configuration" has no config file — the classifier is deterministic code
    (classifier.py waterfall). Left null pending the PM's definition; the
    classification *prompt* is captured in the prompt snapshot.
    """
    content = find_questionnaire().read_text(encoding="utf-8")
    return {
        "questionnaire": {
            "id": _QUESTIONNAIRE_ID,
            "sha256": _sha256(content),
            "content": content,
        },
        "classification": None,
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
            inputs=_build_input_snapshot(row),
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
