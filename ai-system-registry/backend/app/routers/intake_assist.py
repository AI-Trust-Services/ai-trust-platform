"""AI-assisted registration — stateless bounded-agentic turn + document extraction.

All routes are gated SYSTEMS_WRITE. Nothing is persisted here: the frontend holds
the transcript + field state and resends it each turn (design Q7). Persistence
happens at the extended POST /v1/intake once the user confirms.

Two role variants share the same internal helpers:
  - owner  : /intake/assist/turn, /intake/assist/extract
  - engineer: /intake/assist/engineer/{system_id}/turn, /intake/assist/engineer/{system_id}/extract
  - questionnaire: /intake/assist/questionnaire/{system_id}/turn, /intake/assist/questionnaire/{system_id}/extract
    (stateful: fetches existing answers/flags from DB as context for the chatbot)
"""
from __future__ import annotations

import os
from typing import Any, Literal

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from pydantic import BaseModel
from sqlalchemy import select

from ai_trust_authorization import require_permission
from ai_trust_authorization.constants import SYSTEMS_WRITE
from ai_trust_logging import get_logger
from ai_trust_persistence import SessionLocal
from ai_trust_persistence.models.ai_system import AISystem
from app.classifier import CLASSIFIER_INPUTS, _classify_from_flags
from app.documents import DocumentParseError, is_supported, parse_document
from app.llm import (
    LLM_VISION_MODEL,
    LLMParseError,
    build_doc_extract_messages,
    build_engineer_doc_extract_messages,
    build_engineer_turn_messages,
    build_infer_flags_messages,
    build_turn_messages,
    build_questionnaire_turn_messages,
    build_questionnaire_extract_messages,
    chat,
    parse_json_response,
)
from app.schemas import (
    AssistExtractResponse,
    AssistTurnRequest,
    AssistTurnResponse,
    InferredFlag,
)

router = APIRouter(tags=["intake-assist"])
logger = get_logger(__name__)

TURN_CAP = int(os.environ.get("ASSIST_TURN_CAP", "12"))

_AI_UNAVAILABLE = "AI assistant is unavailable. Please switch to the manual form."


class QuestionnaireTurnRequest(BaseModel):
    section: Literal["business", "technical"]
    transcript: list[Any] = []
    fields: dict[str, Any] = {}


async def _run_assist_turn(
    transcript: list[dict],
    fields: dict[str, Any],
    build_messages_fn: Any,
    infer_fields: dict[str, Any] | None = None,
    task: str = "turn",
    run_flag_inference: bool = True,
) -> AssistTurnResponse:
    """Shared turn logic for owner, engineer, and questionnaire flows."""
    try:
        result = await chat(build_messages_fn(transcript, fields), json_mode=True, task=task)
        parsed = await parse_json_response(result["text"], task=task)
    except (LLMParseError, Exception) as exc:  # noqa: BLE001
        logger.error("intake_assist.turn_failed", extra={"error": str(exc)})
        raise HTTPException(status_code=502, detail=_AI_UNAVAILABLE) from exc

    extracted = parsed.get("extracted_fields") or {}
    if isinstance(extracted, dict):
        fields.update({k: v for k, v in extracted.items() if v not in (None, "")})

    complete = bool(parsed.get("complete"))
    user_turns = sum(1 for m in transcript if m["role"] == "user")
    degraded = False
    if not complete and user_turns >= TURN_CAP:
        complete = True
        degraded = True
        logger.info("intake_assist.turn_cap_reached", extra={"user_turns": user_turns})

    response = AssistTurnResponse(
        message=parsed.get("message") or "",
        extracted_fields=fields,
        next_field=parsed.get("next_field"),
        complete=complete,
        degraded=degraded,
    )

    if complete and not degraded and run_flag_inference:
        inference_fields = {**(infer_fields or {}), **fields}
        try:
            flags_result = await chat(build_infer_flags_messages(inference_fields), json_mode=True, task="infer_flags")
            flags_parsed = await parse_json_response(flags_result["text"], task="infer_flags")
            inferred = [InferredFlag(**f) for f in flags_parsed.get("inferred_flags", [])]
        except (LLMParseError, Exception) as exc:  # noqa: BLE001
            logger.error("intake_assist.infer_flags_failed", extra={"error": str(exc)})
            raise HTTPException(status_code=502, detail=_AI_UNAVAILABLE) from exc

        response.inferred_flags = inferred
        response.classification = _classify_from_flags(inferred)
        logger.info(
            "intake_assist.completed",
            extra={"tier": response.classification.tier, "flag_count": len(inferred)},
        )

    return response


async def _run_assist_extract(
    file: UploadFile,
    build_messages_fn: Any,
    task: str = "doc_extract",
) -> AssistExtractResponse:
    """Shared document extraction logic."""
    if not file.filename or not is_supported(file.filename):
        raise HTTPException(status_code=400, detail="Unsupported or missing file.")

    content = await file.read()
    try:
        doc = parse_document(file.filename, content)
    except DocumentParseError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    if doc.is_image:
        messages = build_messages_fn(image_b64=doc.image_b64, media_type=doc.media_type)
        model = LLM_VISION_MODEL
    else:
        messages = build_messages_fn(parsed_text=doc.text)
        model = None

    try:
        result = await chat(messages, model=model, json_mode=True, task=task)
        parsed = await parse_json_response(result["text"], task=task)
    except (LLMParseError, Exception) as exc:  # noqa: BLE001
        logger.error("intake_assist.extract_failed", extra={"error": str(exc), "file_name": file.filename})
        raise HTTPException(status_code=502, detail=_AI_UNAVAILABLE) from exc

    extracted = parsed.get("extracted_fields") or {}
    logger.info(
        "intake_assist.extracted",
        extra={"file_name": file.filename, "is_image": doc.is_image, "field_count": len(extracted)},
    )
    return AssistExtractResponse(extracted_fields=extracted, notes=parsed.get("notes"))


# ---------------------------------------------------------------------------
# Owner endpoints
# ---------------------------------------------------------------------------

@router.post(
    "/intake/assist/turn",
    response_model=AssistTurnResponse,
    dependencies=[Depends(require_permission(SYSTEMS_WRITE))],
)
async def assist_turn(body: AssistTurnRequest) -> AssistTurnResponse:
    transcript = [{"role": m.role, "content": m.content} for m in body.transcript]
    fields = dict(body.fields)
    return await _run_assist_turn(transcript, fields, build_turn_messages)


@router.post(
    "/intake/assist/extract",
    response_model=AssistExtractResponse,
    dependencies=[Depends(require_permission(SYSTEMS_WRITE))],
)
async def assist_extract(file: UploadFile = File(...)) -> AssistExtractResponse:
    return await _run_assist_extract(file, build_doc_extract_messages)


# ---------------------------------------------------------------------------
# Engineer endpoints
# ---------------------------------------------------------------------------

@router.post(
    "/intake/assist/engineer/{system_id}/turn",
    response_model=AssistTurnResponse,
    dependencies=[Depends(require_permission(SYSTEMS_WRITE))],
)
async def engineer_assist_turn(system_id: str, body: AssistTurnRequest) -> AssistTurnResponse:
    transcript = [{"role": m.role, "content": m.content} for m in body.transcript]
    fields = dict(body.fields)

    async with SessionLocal() as session:
        result = await session.execute(select(AISystem).where(AISystem.id == system_id))
        row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(404, f"System {system_id} not found")

    owner_fields = {
        "system_name": row.name,
        "purpose": row.intended_purpose,
        "department": row.department,
        "use_case": row.use_case,
        "people_affected": row.people_affected,
        "decision_context": row.decision_context,
        "human_involvement": row.autonomy_level,
    }

    return await _run_assist_turn(transcript, fields, build_engineer_turn_messages, infer_fields=owner_fields)


@router.post(
    "/intake/assist/engineer/{system_id}/extract",
    response_model=AssistExtractResponse,
    dependencies=[Depends(require_permission(SYSTEMS_WRITE))],
)
async def engineer_assist_extract(system_id: str, file: UploadFile = File(...)) -> AssistExtractResponse:
    async with SessionLocal() as session:
        result = await session.execute(select(AISystem).where(AISystem.id == system_id))
        row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(404, f"System {system_id} not found")

    return await _run_assist_extract(file, build_engineer_doc_extract_messages)


# ---------------------------------------------------------------------------
# Questionnaire endpoints (stateful — system must exist)
# ---------------------------------------------------------------------------

@router.post(
    "/intake/assist/questionnaire/{system_id}/turn",
    response_model=AssistTurnResponse,
    dependencies=[Depends(require_permission(SYSTEMS_WRITE))],
)
async def questionnaire_turn(system_id: str, body: QuestionnaireTurnRequest) -> AssistTurnResponse:
    transcript = [{"role": m["role"], "content": m["content"]} if isinstance(m, dict) else {"role": m.role, "content": m.content} for m in body.transcript]
    fields = dict(body.fields)
    section = body.section

    async with SessionLocal() as session:
        result = await session.execute(select(AISystem).where(AISystem.id == system_id))
        row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(404, f"System {system_id} not found")

    if section == "business":
        # Seed context from existing questionnaire_answers + top-level descriptive columns.
        existing_data: dict[str, Any] = {
            "intended_purpose": row.intended_purpose or "",
            "department": row.department or "",
            "use_case": row.use_case or "",
            "people_affected": row.people_affected or "",
            "decision_context": row.decision_context or "",
            **(row.questionnaire_answers or {}),
        }
        task = "questionnaire_turn_business"

        def build_fn(t: list[dict], f: dict[str, Any]) -> list[dict]:
            return build_questionnaire_turn_messages("business", t, f, existing_data)

        return await _run_assist_turn(transcript, fields, build_fn, task=task, run_flag_inference=False)

    else:
        # Seed context from existing boolean flag values.
        existing_flags: dict[str, Any] = {
            name: getattr(row, name, False) for name in CLASSIFIER_INPUTS
        }
        owner_fields = {
            "system_name": row.name,
            "purpose": row.intended_purpose or "",
            "department": row.department or "",
            "use_case": row.use_case or "",
            "people_affected": row.people_affected or "",
            "decision_context": row.decision_context or "",
            **(row.questionnaire_answers or {}),
        }
        task = "questionnaire_turn_technical"

        def build_fn(t: list[dict], f: dict[str, Any]) -> list[dict]:  # type: ignore[misc]
            return build_questionnaire_turn_messages("technical", t, f, existing_flags)

        return await _run_assist_turn(transcript, fields, build_fn, infer_fields=owner_fields, task=task, run_flag_inference=True)


@router.post(
    "/intake/assist/questionnaire/{system_id}/extract",
    response_model=AssistExtractResponse,
    dependencies=[Depends(require_permission(SYSTEMS_WRITE))],
)
async def questionnaire_extract(
    system_id: str,
    section: Literal["business", "technical"] = Query(default="business"),
    file: UploadFile = File(...),
) -> AssistExtractResponse:
    async with SessionLocal() as session:
        result = await session.execute(select(AISystem).where(AISystem.id == system_id))
        row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(404, f"System {system_id} not found")

    def build_fn(**kwargs: Any) -> list[dict]:
        return build_questionnaire_extract_messages(section, **kwargs)

    return await _run_assist_extract(file, build_fn, task="questionnaire_doc_extract")
