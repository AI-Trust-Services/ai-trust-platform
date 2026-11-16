"""Single-page EU AI Act assessment endpoints (issues #346 / #314).

The owner-facing assessment flow: open (AI prefill + classification), read the
full state (start page + sidebar), per-question autosave / confirm / comment /
assign, finalize, and submit to the compliance officer. Replaces the
section-sequenced questionnaire modal flow.

All routes are per-system and `ai`-registration-mode oriented. Each route owns
its transaction (``async with SessionLocal()``), per the repo convention.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request
from sqlalchemy import func, select

from ai_trust_authorization import require_permission
from ai_trust_authorization.constants import (
    SYSTEMS_APPROVE,
    SYSTEMS_READ,
    SYSTEMS_WRITE,
)
from ai_trust_logging import get_logger
from ai_trust_persistence import SessionLocal
from ai_trust_persistence.governance import (
    generate_obligations_in_session,
    generate_requirements_in_session,
    sync_system_compliance,
)
from ai_trust_persistence.models.ai_system import AISystem
from ai_trust_persistence.models.assessment import Assessment
from ai_trust_persistence.models.obligation import Obligation
from ai_trust_persistence.models.question_comment import QuestionComment
from ai_trust_persistence.models.question_state import QuestionState
from ai_trust_persistence.models.system_workflow_step import SystemWorkflowStep

from app import email_sender
from app.assessment_catalogue import (
    ASSESSMENT_QUESTION_KEYS,
    QUESTION_TYPES,
)
from app.assessment_prefill_pipeline import run_assessment_prefill_pipeline
from app.classifier import classify_ai_questionnaire
from app.ids import new_id
from app.llm import LLMParseError
from app.questionnaire_required import QUESTION_LABEL
from app.schemas.assessment import (
    AnswerRequest,
    AssessmentStateResponse,
    AssignRequest,
    CommentCreate,
    CommentResponse,
    ConfidenceCounts,
    ContributorRef,
    ConfirmResponse,
    QuestionStateResponse,
    SourceDocumentRef,
    SubmitRequest,
    IssueRequest,
    RejectRequest,
    _validate_question_key,
)

router = APIRouter(tags=["assessment"])
logger = get_logger(__name__)

_AI_UNAVAILABLE = "AI classification is unavailable. Please try again shortly."

# The single-page assessment flow is EU-AI-Act-specific (classifier, question
# catalogue, and prompts are all EU AI Act). The compliance Assessment record it
# creates is therefore always under this framework (seeded by persistence
# migration 0003). Named here rather than inlined as a magic string.
_EU_AI_ACT_FRAMEWORK_ID = "FRM-EU-AI-ACT"

# answerStrength (pipeline) → confidence band; the lowest wins for MULTISELECT.
_STRENGTH_RANK = {"HIGH": 3, "MEDIUM": 2, "LOW": 1}


# ── helpers ──────────────────────────────────────────────────────────────────


def _current_user(request: Request) -> str:
    return request.headers.get("x-forwarded-preferred-username", "unknown")


async def _get_system(session, system_id: str) -> AISystem:
    result = await session.execute(select(AISystem).where(AISystem.id == system_id))
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(404, f"System {system_id} not found")
    return row


def _system_owner(row: AISystem) -> str | None:
    """The owner username (creator). Stored as a plain string in business_owners."""
    owner = row.business_owners
    if isinstance(owner, str):
        return owner.strip() or None
    return None


def _answer_store(row: AISystem) -> dict:
    """The full questionnaire_answers dict (never None)."""
    return dict(row.questionnaire_answers or {})


def _read_answer(row: AISystem, answers: dict, question_key: str) -> str | None:
    """Read a question's answer from the flat questionnaire_answers JSONB dict
    (keys are the ai-questionnaire.json question ids)."""
    v = answers.get(question_key)
    if v is None:
        return None
    return str(v)


def _write_answer(row: AISystem, answers: dict, question_key: str, value: str) -> dict:
    """Write a question's answer into the flat questionnaire_answers JSONB dict
    and return the updated dict."""
    out = dict(answers)
    out[question_key] = value
    return out


def _proposals_from_results(results: list[Any]) -> dict[str, dict[str, Any]]:
    """Convert questionnaire-pipeline ``results`` into per-question proposals.

    Returns ``{question_id: {answer, confidence, references, explanation}}`` for
    every known question that has a non-empty answer. Unknown ids and unanswered
    items are skipped (the caller seeds those blank, with no confidence band).

    MULTISELECT always serialises to a JSON array (even one option) — the frontend
    JSON.parse()s it; PREDEFINED/DESCRIPTIVE use the plain value. ``answerStrength``
    (HIGH/MEDIUM/LOW) maps to a confidence band; for MULTISELECT the lowest
    strength across the returned options wins. No strength ⇒ ``None`` — the prompt
    requires a null ``answerStrength`` for ``NOT_ENOUGH_INFORMATION``/``CONFLICT``,
    which is "not assessed", not "low confidence"."""
    known = set(ASSESSMENT_QUESTION_KEYS)
    out: dict[str, dict[str, Any]] = {}
    for item in results:
        if not isinstance(item, dict):
            continue
        q_key = item.get("questionId")
        if q_key not in known:
            continue
        options = [a for a in (item.get("answer") or []) if isinstance(a, dict)]
        values = [str(a["value"]) for a in options if a.get("value") not in (None, "")]
        if not values:
            continue
        value = (
            json.dumps(values)
            if len(values) > 1 or QUESTION_TYPES.get(q_key) == "MULTISELECT"
            else values[0]
        )
        answered_options = [a for a in options if a.get("value") not in (None, "")]
        confidence = (
            min(
                (a["answerStrength"] for a in answered_options),
                key=lambda s: _STRENGTH_RANK[s],
            ).lower()
            if all(a.get("answerStrength") in _STRENGTH_RANK for a in answered_options)
            else None
        )
        out[q_key] = {
            "answer": value,
            "confidence": confidence,
            "references": item.get("references") or [],
            "explanation": item.get("explanation") or None,
        }
    return out


def _sources_from_proposals(
    proposals: dict[str, dict[str, Any]],
) -> list[SourceDocumentRef]:
    """Distinct source documents cited across all answers' evidence references,
    in first-seen order (assessment-level "sources that informed this")."""
    seen: dict[str, SourceDocumentRef] = {}
    for p in proposals.values():
        for ref in p["references"]:
            name = ref.get("source") if isinstance(ref, dict) else None
            if name and name not in seen:
                seen[name] = SourceDocumentRef(name=name)
    return list(seen.values())


async def _states_by_key(session, assessment_id: str) -> dict[str, QuestionState]:
    result = await session.execute(
        select(QuestionState).where(QuestionState.assessment_id == assessment_id)
    )
    return {s.question_key: s for s in result.scalars().all()}


async def _comment_counts(session, assessment_id: str) -> dict[str, int]:
    # SQL aggregate (count per question_key) — avoids loading full comment rows
    # (incl. body text) into memory just to count them.
    result = await session.execute(
        select(QuestionComment.question_key, func.count().label("n"))
        .where(
            QuestionComment.assessment_id == assessment_id,
            QuestionComment.deleted_at.is_(None),
        )
        .group_by(QuestionComment.question_key)
    )
    return {row.question_key: row.n for row in result.all()}


async def _qualifying_comment_keys(
    session, assessment_id: str, states: dict[str, QuestionState]
) -> set[str]:
    """Question keys that have a non-deleted comment recorded AT/AFTER the answer
    last changed — i.e. a comment that *qualifies* for the mandatory-comment-on-
    change confirm gate. Mirrors the gate in ``confirm_question`` so the frontend
    can enable/disable Confirm exactly as the backend will accept it. Questions
    whose ``answer_changed_at`` is null are treated as 'any non-deleted comment
    qualifies' (same fallback as the gate). Scoped to one assessment cycle."""
    result = await session.execute(
        select(QuestionComment.question_key, func.max(QuestionComment.created_at))
        .where(
            QuestionComment.assessment_id == assessment_id,
            QuestionComment.deleted_at.is_(None),
        )
        .group_by(QuestionComment.question_key)
    )
    latest_by_key = {k: ts for k, ts in result.all()}
    qualifying: set[str] = set()
    for key, latest in latest_by_key.items():
        changed_at = states.get(key).answer_changed_at if states.get(key) else None
        if changed_at is None or (latest is not None and latest >= changed_at):
            qualifying.add(key)
    return qualifying


def _needs_attention(
    row: AISystem, state: QuestionState | None, answer: str | None
) -> bool:
    """A question needs the owner's attention when the AI did not establish an
    answer — AND it has not yet been owner-confirmed. Confirming clears it.

    "Did not establish" covers both bands below HIGH/MEDIUM:
    ``low`` (a suggested pre-fill the prompt says requires human verification) and
    *no band at all* (``confidence is None``). The latter is the pipeline's
    ``NOT_ENOUGH_INFORMATION`` / ``CONFLICT`` outcome, where ``answerStrength`` is
    null by contract — note the answer string is then non-blank, so the
    empty-answer check below does not catch it. HIGH/MEDIUM answers are
    auto-confirmed on the owner's behalf, so they exit at the guard above."""
    if _is_owner_confirmed(row, state):
        return False
    if state is not None and state.confidence in (None, "low"):
        return True
    return answer is None or (isinstance(answer, str) and not answer.strip())


def _may_edit(row: AISystem, state: QuestionState | None, user: str) -> bool:
    """Owner may edit any question; an assignee may edit theirs; a question with
    no assignee defaults to the owner."""
    if user == _system_owner(row):
        return True
    if state is not None and state.assignee_username:
        return user == state.assignee_username
    return False


# Statuses in which the whole assessment is read-only (locked to the owner): the
# owner has submitted (pending_review) or the CO has approved. `pending_review`
# IS the "locked" state — there is no separate `locked` value.
_LOCKED_STATUSES = frozenset({"pending_review", "approved"})


def _is_editable(row: AISystem) -> bool:
    """Assessment-level gate: false once submitted/locked or approved."""
    return row.workflow_status not in _LOCKED_STATUSES


def _status_label(row: AISystem) -> str:
    """Owner-facing lifecycle label derived from workflow_status."""
    ws = row.workflow_status
    if ws in ("pending_review",):
        return "locked"
    if ws == "returned":
        # Backend records 'returned'; the owner sees it as 'under_review' (#348).
        return "under_review"
    if ws == "approved":
        return "approved"
    return ws


def _is_owner_confirmed(row: AISystem, state: QuestionState | None) -> bool:
    """A question counts toward the submit gate only when the SYSTEM OWNER
    confirmed it — a contributor's confirmation is progress, not sufficient."""
    if state is None or state.confirmed_at is None:
        return False
    return state.confirmed_by == _system_owner(row)


def _owner_unconfirmed(row: AISystem, states: dict[str, QuestionState]) -> list[str]:
    """Question keys NOT yet owner-confirmed — the finalize/submit gate."""
    return [
        q
        for q in ASSESSMENT_QUESTION_KEYS
        if not _is_owner_confirmed(row, states.get(q))
    ]


async def _current_assessment(session, system_id: str) -> Assessment | None:
    """The most-recent non-inactive compliance Assessment for this system — the
    row the owner's Assessments tab treats as current."""
    result = await session.execute(
        select(Assessment)
        .where(
            Assessment.ai_system_id == system_id,
            Assessment.status != "inactive",
        )
        .order_by(Assessment.created_at.desc())
        .limit(1)
    )
    return result.scalar_one_or_none()


async def _ensure_assessment(session, row: AISystem) -> Assessment:
    """Return the current (non-inactive) compliance Assessment for this system,
    creating a fresh ``questionnaire_pending`` one if none exists. Idempotent;
    caller owns the transaction. Keeps the governance tables (owner's Assessments
    tab, /home/assessments) in sync with the single-page flow, and self-heals
    systems prefilled before this existed. The returned Assessment's ``id`` is the
    scope key for this cycle's question_states / question_comments."""
    current = await _current_assessment(session, row.id)
    if current is not None:
        return current
    # Title each cycle with its sequence number so obligations/requirements filters
    # and the assessments list distinguish cycles ("… (#1)", "(#2)", …). Count all
    # EU-AI-Act assessments for this system (incl. inactive/superseded) for the seq.
    prior = (
        await session.execute(
            select(func.count())
            .select_from(Assessment)
            .where(
                Assessment.ai_system_id == row.id,
                Assessment.framework_id == _EU_AI_ACT_FRAMEWORK_ID,
            )
        )
    ).scalar_one()
    assessment = Assessment(
        id=new_id("ASS"),
        ai_system_id=row.id,
        framework_id=_EU_AI_ACT_FRAMEWORK_ID,
        title=f"EU AI Act Assessment — {row.name} (#{prior + 1})",
        status="questionnaire_pending",
    )
    session.add(assessment)
    # Flush so the new id is usable as an FK by freshly-seeded question_states.
    await session.flush()
    return assessment


# ── open / prefill ─────────────────────────────────────────────────────────


async def _run_prefill_background(
    system_id: str,
    assessment_id: str,
    username: str,
) -> None:
    """Background task started by ``/open``: run the AI-assessment prefill pipeline
    (questionnaire run → classification run) with this assessment's persistence hooks.

    The pipelines themselves (``app/questionnaire_pipeline.py``,
    ``app/classification_pipeline.py``) are the same functions ``POST
    /questionnaire-llm-run`` and ``POST /classification-llm-run`` trigger; only
    these hooks are specific to the assessment:

    * ``_on_batch`` — after each questionnaire batch, write its answers into the
      existing ``question_states`` so the frontend sees them while polling
      ``GET /state``.
    * ``_finalize_tier`` — once the questionnaire is done (concurrently with the
      label classification), derive the tier, ``org_role`` and sources and clear
      ``assessment.llm_status`` in one transaction.

    A failure of the questionnaire run or of ``_finalize_tier`` sets
    ``llm_status="failed"`` (the frontend's retry banner); a failure of the label
    classification is only logged by the pipeline (its output is not shown yet).
    """

    async def _on_batch(batch_results: list) -> None:
        """Persist one batch's answers into the existing question_states rows.

        High- and medium-confidence answers are auto-confirmed on behalf of the
        system owner (matching the feature-branch behaviour): the owner can still
        review, change, and re-confirm any question, but they don't need to
        manually tick every pre-filled answer with a good confidence score.
        Low-confidence and unanswered questions remain unconfirmed and are
        flagged for attention.
        """
        proposals = _proposals_from_results(batch_results)
        if not proposals:
            return
        async with SessionLocal() as session:
            row = await _get_system(session, system_id)
            owner = _system_owner(row)
            answers = _answer_store(row)
            states = await _states_by_key(session, assessment_id)
            now = datetime.now(timezone.utc)
            for q_key, prop in proposals.items():
                ans = prop["answer"]
                if not ans:
                    continue
                answers = _write_answer(row, answers, q_key, ans)
                st = states.get(q_key)
                if st is not None:
                    st.answer = ans
                    st.ai_original_answer = ans
                    st.confidence = prop["confidence"]
                    st.ai_references = prop["references"] or None
                    st.ai_explanation = prop["explanation"] or None
                    # Auto-confirm high/medium confidence answers on behalf of the
                    # owner so they don't need to click through every pre-filled
                    # question. Low confidence stays unconfirmed (needs attention).
                    if prop["confidence"] in ("high", "medium") and owner:
                        st.confirmed_at = now
                        st.confirmed_by = owner
            row.questionnaire_answers = answers
            await session.commit()
            logger.info(
                "assessment.prefill_batch_applied",
                extra={
                    "system_id": system_id,
                    "assessment_id": assessment_id,
                    "questions": len(proposals),
                },
            )

    async def _finalize_tier(questionnaire_output: dict) -> None:
        """Tier step: classify from the persisted answers, then clear llm_status.

        Raises on a classifier failure so the surrounding handler marks the
        prefill failed (nothing is written, the next ``/open`` retries).
        """
        proposals = _proposals_from_results(
            (questionnaire_output.get("result") or {}).get("results") or []
        )
        async with SessionLocal() as session:
            row = await _get_system(session, system_id)
            try:
                classification, rationale = await classify_ai_questionnaire(row)
            except Exception as exc:  # noqa: BLE001
                logger.error("assessment.classify_failed", extra={"error": str(exc)})
                raise
            row.tier = classification.tier
            row.basis = classification.basis
            row.annex_iii_area = classification.annex_iii_area
            row.classification_rationale = rationale
            if rationale.get("org_role"):
                row.org_role = rationale["org_role"]
            row.assessment_sources = [
                s.model_dump() for s in _sources_from_proposals(proposals)
            ]
            assessment = await _current_assessment(session, system_id)
            if assessment:
                assessment.llm_status = None
            await session.commit()
            logger.info(
                "assessment.prefill_completed",
                extra={"system_id": system_id, "tier": row.tier},
            )

    try:
        await run_assessment_prefill_pipeline(
            system_id,
            username,
            batch_callback=_on_batch,
            on_questionnaire_done=_finalize_tier,
        )
    except Exception as exc:  # noqa: BLE001
        logger.error(
            "assessment.prefill_background_failed",
            extra={"system_id": system_id, "error": str(exc)},
        )
        async with SessionLocal() as session:
            assessment = await _current_assessment(session, system_id)
            if assessment:
                assessment.llm_status = "failed"
            await session.commit()


@router.post(
    "/systems/{system_id}/assessment/open",
    response_model=AssessmentStateResponse,
)
async def open_assessment(
    system_id: str,
    request: Request,
    background_tasks: BackgroundTasks,
    _: str = Depends(require_permission(SYSTEMS_WRITE)),
):
    """Seed blank question states immediately and return; the AI prefill runs in
    the background.

    On first open: seeds all question_states (blank answers, no confidence band,
    all unconfirmed), marks ``assessment.llm_status = "pending"``, then schedules
    ``_run_prefill_background`` as a FastAPI background task (fires after the HTTP
    response is sent). Returns the blank state immediately with
    ``prefill_pending=True`` so the client can start polling GET /state.

    Idempotent: if question_states already exist (even with llm_status=pending from
    a prior open), returns the current state without re-seeding or re-running.
    """
    async with SessionLocal() as session:
        row = await _get_system(session, system_id)
        assessment = await _ensure_assessment(session, row)
        existing = await _states_by_key(session, assessment.id)
        if existing:
            # Retry after a background failure: clear llm_status and re-schedule.
            if assessment.llm_status == "failed":
                assessment.llm_status = "pending"
                await session.commit()
                background_tasks.add_task(
                    _run_prefill_background,
                    system_id,
                    assessment.id,
                    _current_user(request),
                )
            else:
                await session.commit()
            return await _build_state(session, row, _current_user(request), assessment)

        # Seed all question_states blank — answers arrive via the background task.
        for q_key in ASSESSMENT_QUESTION_KEYS:
            session.add(
                QuestionState(
                    id=new_id("QST"),
                    assessment_id=assessment.id,
                    system_id=system_id,
                    question_key=q_key,
                    answer=None,
                    answer_source="ai_prefilled",
                    ai_original_answer=None,
                    # No answer yet ⇒ no confidence band at all (not "low", which
                    # would render a misleading red chip). The background prefill
                    # overwrites this for every question the LLM answers.
                    confidence=None,
                    ai_references=None,
                    ai_explanation=None,
                )
            )
        assessment.llm_status = "pending"
        await session.commit()
        logger.info(
            "assessment.opened",
            extra={"system_id": system_id, "prefill": "background"},
        )

    background_tasks.add_task(
        _run_prefill_background,
        system_id,
        assessment.id,
        _current_user(request),
    )

    async with SessionLocal() as session:
        row = await _get_system(session, system_id)
        assessment = await _current_assessment(session, system_id)
        return await _build_state(session, row, _current_user(request), assessment)


async def _build_state(
    session,
    row: AISystem,
    user: str | None = None,
    assessment: Assessment | None = None,
) -> AssessmentStateResponse:
    # The cycle this view is scoped to. Defaults to the current assessment; a
    # specific (possibly historical/approved) assessment can be passed for a
    # read-only "View results" of that cycle.
    if assessment is None:
        assessment = await _ensure_assessment(session, row)
    current = await _current_assessment(session, row.id)
    is_current = current is not None and current.id == assessment.id
    # A historical (non-current) cycle is always read-only; the live cycle uses
    # the system-level lock.
    frozen = not is_current
    states = await _states_by_key(session, assessment.id)
    counts = await _comment_counts(session, assessment.id)
    qualifying = await _qualifying_comment_keys(session, assessment.id, states)
    answers = _answer_store(row)
    editable = (not frozen) and _is_editable(row)

    conf = ConfidenceCounts()
    attention = 0
    questions: list[QuestionStateResponse] = []
    for q_key in ASSESSMENT_QUESTION_KEYS:
        st = states.get(q_key)
        # The frozen per-cycle answer lives on the question_state; fall back to the
        # live system row only when a state has no stored answer (older rows).
        ans = (st.answer if st and st.answer is not None else None) or _read_answer(
            row, answers, q_key
        )
        if st is not None and st.confidence == "high":
            conf.high += 1
        elif st is not None and st.confidence == "medium":
            conf.medium += 1
        elif st is not None and st.confidence == "low":
            conf.low += 1
        # llm_pending: the background prefill is still running and this specific
        # question has not yet received an AI answer. Once the batch covering this
        # question completes, answer is written and llm_pending flips to False.
        llm_pending = assessment.llm_status == "pending" and not ans
        needs = _needs_attention(row, st, ans)
        # Suppress attention while the LLM is still pending for this question —
        # the answer hasn't arrived yet, so there's nothing to review.
        if needs and not llm_pending:
            attention += 1
        # Per-question edit right for the requesting user — only meaningful while
        # the assessment is editable (current cycle, not locked/approved).
        can_edit = editable and (user is not None and _may_edit(row, st, user))
        questions.append(
            QuestionStateResponse(
                question_key=q_key,
                answer=ans,
                answer_source=st.answer_source if st else "ai_prefilled",
                confidence=st.confidence if st else None,
                confirmed=bool(st and st.confirmed_at),
                owner_confirmed=_is_owner_confirmed(row, st),
                assignee_username=st.assignee_username if st else None,
                comment_count=counts.get(q_key, 0),
                has_qualifying_comment=q_key in qualifying,
                needs_attention=needs and not llm_pending,
                can_edit=can_edit,
                ai_references=(st.ai_references or []) if st else [],
                ai_explanation=st.ai_explanation if st else None,
                llm_pending=llm_pending,
            )
        )

    # Classification: for a historical (frozen) cycle use the Assessment's snapshot
    # (what it was approved at); for the live cycle use the system row.
    snap = frozen and assessment.tier is not None
    tier = assessment.tier if snap else row.tier
    basis = assessment.basis if snap else row.basis
    org_role = assessment.org_role if snap else row.org_role
    co_transparency = (
        assessment.co_issued_transparency if snap else row.co_issued_transparency
    )
    # Transparency obligation also derives from the chatbot / synthetic-content
    # flags; read the frozen snapshot for a historical cycle so a later edit to
    # the live system row doesn't rewrite what the cycle was approved at.
    is_chatbot = assessment.is_chatbot if snap else row.is_chatbot
    gen_synthetic = (
        assessment.generates_synthetic_content
        if snap
        else row.generates_synthetic_content
    )
    rationale = (
        assessment.classification_rationale if snap else row.classification_rationale
    ) or {}
    sources_raw = assessment.assessment_sources if snap else row.assessment_sources

    # Source documents that informed the classification (assessment-level).
    # Prefer the persisted retrieval sources (they carry page numbers); fall back
    # to the registration document names when no prefill sources were captured.
    if sources_raw:
        source_docs = [
            SourceDocumentRef(name=s.get("name", "document"), page=s.get("page"))
            for s in sources_raw
        ]
    else:
        docs = row.registration_documents or []
        # registration_documents entries store the name under "filename" (see
        # RegistrationDocument in systems.py); "name" would always miss → "document".
        source_docs = [
            SourceDocumentRef(name=d.get("filename", "document")) for d in docs
        ]

    # Candidate assignees: the owner + the system's registered contributors.
    contributor_refs: list[ContributorRef] = []
    seen: set[str] = set()
    for uname in [_system_owner(row), *(row.contributors or [])]:
        if uname and uname not in seen:
            seen.add(uname)
            contributor_refs.append(ContributorRef(username=uname))

    return AssessmentStateResponse(
        system_id=row.id,
        assessment_id=assessment.id,
        system_name=row.name,
        registration_mode=row.registration_mode,
        owner_username=_system_owner(row),
        workflow_status=row.workflow_status,
        status_label="approved" if frozen else _status_label(row),
        editable=editable,
        tier=tier,
        basis=basis,
        org_role=org_role,
        reasoning=rationale.get("reasoning"),
        transparency=tier == "high"
        and bool(co_transparency or is_chatbot or gen_synthetic),
        confidence_counts=conf,
        attention_count=attention,
        # No flag→question mapping exists for the ai-questionnaire.json ids, so the
        # "Why this classification" list is empty (the reasoning text still shows).
        decisive_questions=[],
        source_documents=source_docs,
        questions=questions,
        contributors=contributor_refs,
        prefilled=bool(states),
        prefill_pending=assessment.llm_status == "pending",
        prefill_failed=assessment.llm_status == "failed",
    )


@router.get(
    "/systems/{system_id}/assessment/state",
    response_model=AssessmentStateResponse,
)
async def get_assessment_state(
    system_id: str,
    request: Request,
    assessment_id: str | None = None,
    _: str = Depends(require_permission(SYSTEMS_READ)),
):
    """Current cycle by default; pass ``?assessment_id=ASS-…`` to view a specific
    (e.g. historical/approved) cycle read-only ("View results")."""
    async with SessionLocal() as session:
        row = await _get_system(session, system_id)
        target = None
        if assessment_id:
            result = await session.execute(
                select(Assessment).where(
                    Assessment.id == assessment_id,
                    Assessment.ai_system_id == system_id,
                )
            )
            target = result.scalar_one_or_none()
            if target is None:
                raise HTTPException(404, "Assessment not found for this system")
        return await _build_state(session, row, _current_user(request), target)


# ── per-question: answer / confirm ───────────────────────────────────────────


async def _load_state(session, assessment_id: str, question_key: str) -> QuestionState:
    result = await session.execute(
        select(QuestionState).where(
            QuestionState.assessment_id == assessment_id,
            QuestionState.question_key == question_key,
        )
    )
    return result.scalar_one_or_none()


@router.post(
    "/systems/{system_id}/assessment/questions/{question_key}/answer",
    response_model=QuestionStateResponse,
)
async def save_answer(
    system_id: str,
    question_key: str,
    body: AnswerRequest,
    request: Request,
    _: str = Depends(require_permission(SYSTEMS_WRITE)),
):
    _validate_question_key(question_key)
    user = _current_user(request)
    async with SessionLocal() as session:
        row = await _get_system(session, system_id)
        if not _is_editable(row):
            raise HTTPException(409, "Assessment is locked and cannot be edited")
        assessment = await _ensure_assessment(session, row)
        state = await _load_state(session, assessment.id, question_key)
        if not _may_edit(row, state, user):
            raise HTTPException(403, "You are not assigned to this question")

        # Capture the previous stored value BEFORE overwriting, so we can detect a
        # genuine change (not just a change from the AI original).
        prev = (state.answer if state and state.answer is not None else None) or (
            _read_answer(row, _answer_store(row), question_key) or ""
        )
        prev = prev.strip()
        new = body.answer.strip()
        # Keep the system row's questionnaire_answers in sync (other consumers read
        # it + the classifier), AND store the frozen per-cycle value on the state.
        answers = _write_answer(row, _answer_store(row), question_key, body.answer)
        row.questionnaire_answers = answers

        # Stamp the answer-change time from the DATABASE clock (func.now()), the
        # same clock QuestionComment.created_at uses (server_default=func.now()),
        # so the confirm gate's `created_at >= answer_changed_at` comparison is
        # not corrupted by backend↔Postgres clock skew on a multi-node deploy.
        change_ts = func.now()
        if state is None:
            state = QuestionState(
                id=new_id("QST"),
                assessment_id=assessment.id,
                system_id=system_id,
                question_key=question_key,
                answer=body.answer or None,
                answer_source="manual",
                ai_original_answer=None,
                answer_changed_at=change_ts,
            )
            session.add(state)
        else:
            state.answer = body.answer or None
            if new != prev:
                # A genuine change: record when it happened (drives the mandatory-
                # comment-on-change gate) and revert any prior confirmation (re-edit
                # ⇒ Incomplete — including a revert back to the AI original).
                state.answer_changed_at = change_ts
                state.confirmed_at = None
                state.confirmed_by = None
                state.answer_source = (
                    "manual"
                    if new != (state.ai_original_answer or "").strip()
                    else "ai_prefilled"
                )
        await session.commit()
        count = (await _comment_counts(session, assessment.id)).get(question_key, 0)
        return QuestionStateResponse(
            question_key=question_key,
            answer=body.answer,
            answer_source=state.answer_source,
            confidence=state.confidence,
            confirmed=bool(state.confirmed_at),
            assignee_username=state.assignee_username,
            comment_count=count,
            needs_attention=_needs_attention(row, state, body.answer),
        )


@router.post(
    "/systems/{system_id}/assessment/questions/{question_key}/confirm",
    response_model=ConfirmResponse,
)
async def confirm_question(
    system_id: str,
    question_key: str,
    request: Request,
    _: str = Depends(require_permission(SYSTEMS_WRITE)),
):
    """Mark a question confirmed. If the answer was changed from the AI pre-fill,
    a comment recorded since that change is mandatory (else 422)."""
    _validate_question_key(question_key)
    user = _current_user(request)
    async with SessionLocal() as session:
        row = await _get_system(session, system_id)
        if not _is_editable(row):
            raise HTTPException(409, "Assessment is locked and cannot be edited")
        assessment = await _ensure_assessment(session, row)
        state = await _load_state(session, assessment.id, question_key)
        if state is None:
            raise HTTPException(404, "Question has no state; open the assessment first")
        if not _may_edit(row, state, user):
            raise HTTPException(403, "You are not assigned to this question")

        current = (state.answer if state.answer is not None else None) or (
            _read_answer(row, _answer_store(row), question_key) or ""
        )
        current = current.strip()
        changed = (
            state.answer_source == "manual"
            and current != (state.ai_original_answer or "").strip()
        )
        if changed:
            # Require a non-deleted comment recorded AT/AFTER the answer change —
            # not merely that some comment exists (which an unrelated earlier
            # comment would satisfy). answer_changed_at is set by save_answer on a
            # genuine change; if it is somehow NULL, fall back to any-comment.
            # Scoped to THIS assessment cycle.
            q = select(QuestionComment).where(
                QuestionComment.assessment_id == assessment.id,
                QuestionComment.question_key == question_key,
                QuestionComment.deleted_at.is_(None),
            )
            if state.answer_changed_at is not None:
                q = q.where(QuestionComment.created_at >= state.answer_changed_at)
            result = await session.execute(q)
            if not result.scalars().first():
                raise HTTPException(
                    422,
                    "A comment explaining the change is required before confirming",
                )

        state.confirmed_at = datetime.now(timezone.utc)
        state.confirmed_by = user
        await session.commit()
        return ConfirmResponse(question_key=question_key, confirmed=True)


@router.post(
    "/systems/{system_id}/assessment/questions/{question_key}/unconfirm",
    response_model=ConfirmResponse,
)
async def unconfirm_question(
    system_id: str,
    question_key: str,
    request: Request,
    _: str = Depends(require_permission(SYSTEMS_WRITE)),
):
    _validate_question_key(question_key)
    user = _current_user(request)
    async with SessionLocal() as session:
        row = await _get_system(session, system_id)
        if not _is_editable(row):
            raise HTTPException(409, "Assessment is locked and cannot be edited")
        assessment = await _ensure_assessment(session, row)
        state = await _load_state(session, assessment.id, question_key)
        if state is None:
            raise HTTPException(404, "Question has no state")
        if not _may_edit(row, state, user):
            raise HTTPException(403, "You are not assigned to this question")
        # Only the user who confirmed it, or the system owner, may clear a
        # confirmation — a contributor must not wipe the owner's sign-off.
        if (
            state.confirmed_by
            and user != state.confirmed_by
            and user != _system_owner(row)
        ):
            raise HTTPException(
                403, "Only the confirmer or the system owner may unconfirm"
            )
        state.confirmed_at = None
        state.confirmed_by = None
        await session.commit()
        return ConfirmResponse(question_key=question_key, confirmed=False)


# ── comments ─────────────────────────────────────────────────────────────────


@router.get(
    "/systems/{system_id}/assessment/questions/{question_key}/comments",
    response_model=list[CommentResponse],
)
async def list_comments(
    system_id: str,
    question_key: str,
    assessment_id: str | None = None,
    _: str = Depends(require_permission(SYSTEMS_READ)),
):
    """Comments for a question in a specific cycle. Pass ``?assessment_id=`` to
    read a historical cycle's comments ("View results"); defaults to the current
    cycle. Read-only — resolves the cycle without creating one (a GET must not
    flush a new Assessment row), so an unopened system simply has no comments."""
    _validate_question_key(question_key)
    async with SessionLocal() as session:
        row = await _get_system(session, system_id)
        if assessment_id:
            result = await session.execute(
                select(Assessment).where(
                    Assessment.id == assessment_id,
                    Assessment.ai_system_id == system_id,
                )
            )
            assessment = result.scalar_one_or_none()
            if assessment is None:
                raise HTTPException(404, "Assessment not found for this system")
        else:
            assessment = await _current_assessment(session, row.id)
        if assessment is None:
            return []
        result = await session.execute(
            select(QuestionComment)
            .where(
                QuestionComment.assessment_id == assessment.id,
                QuestionComment.question_key == question_key,
                QuestionComment.deleted_at.is_(None),
            )
            .order_by(QuestionComment.created_at)
        )
        return [CommentResponse.model_validate(c) for c in result.scalars().all()]


@router.post(
    "/systems/{system_id}/assessment/questions/{question_key}/comments",
    response_model=CommentResponse,
)
async def add_comment(
    system_id: str,
    question_key: str,
    body: CommentCreate,
    request: Request,
    _: str = Depends(require_permission(SYSTEMS_WRITE)),
):
    _validate_question_key(question_key)
    user = _current_user(request)
    async with SessionLocal() as session:
        row = await _get_system(session, system_id)
        if not _is_editable(row):
            raise HTTPException(409, "Assessment is locked and cannot be edited")
        assessment = await _ensure_assessment(session, row)
        state = await _load_state(session, assessment.id, question_key)
        # Commenting follows the same edit right as the answer: owner any, an
        # assignee only their own question (mirrors can_edit / the UI gate).
        if not _may_edit(row, state, user):
            raise HTTPException(403, "You are not assigned to this question")
        comment = QuestionComment(
            id=new_id("QCM"),
            assessment_id=assessment.id,
            system_id=system_id,
            question_key=question_key,
            author_username=user,
            body=body.body,
        )
        session.add(comment)
        await session.commit()
        await session.refresh(comment)
        return CommentResponse.model_validate(comment)


@router.delete(
    "/systems/{system_id}/assessment/questions/{question_key}/comments/{comment_id}",
    response_model=None,
    status_code=204,
)
async def delete_comment(
    system_id: str,
    question_key: str,
    comment_id: str,
    request: Request,
    _: str = Depends(require_permission(SYSTEMS_WRITE)),
):
    """Soft-delete a comment. Authors may delete their own; the system owner may
    delete any."""
    _validate_question_key(question_key)
    user = _current_user(request)
    async with SessionLocal() as session:
        row = await _get_system(session, system_id)
        if not _is_editable(row):
            raise HTTPException(409, "Assessment is locked and cannot be edited")
        assessment = await _ensure_assessment(session, row)
        result = await session.execute(
            select(QuestionComment).where(
                QuestionComment.id == comment_id,
                QuestionComment.assessment_id == assessment.id,
                # Enforce the nested resource path: a comment id from a different
                # question must not be deletable via this URL.
                QuestionComment.question_key == question_key,
            )
        )
        comment = result.scalar_one_or_none()
        if not comment or comment.deleted_at is not None:
            raise HTTPException(404, "Comment not found")
        if user != comment.author_username and user != _system_owner(row):
            raise HTTPException(403, "You may only delete your own comments")
        comment.deleted_at = datetime.now(timezone.utc)
        await session.commit()


# ── assignment ───────────────────────────────────────────────────────────────


@router.post(
    "/systems/{system_id}/assessment/questions/{question_key}/assign",
    response_model=QuestionStateResponse,
)
async def assign_question(
    system_id: str,
    question_key: str,
    body: AssignRequest,
    request: Request,
    background_tasks: BackgroundTasks,
    _: str = Depends(require_permission(SYSTEMS_WRITE)),
):
    _validate_question_key(question_key)
    user = _current_user(request)
    async with SessionLocal() as session:
        row = await _get_system(session, system_id)
        if not _is_editable(row):
            raise HTTPException(409, "Assessment is locked and cannot be edited")
        assessment = await _ensure_assessment(session, row)
        state = await _load_state(session, assessment.id, question_key)
        # Owner may reassign any; a current assignee may reassign their own.
        if not _may_edit(row, state, user):
            raise HTTPException(403, "Only the owner or current assignee may reassign")

        # Assignees are the owner or a registered contributor — reject arbitrary
        # usernames so a direct caller can't delegate data (and trigger a notify
        # email) to an unrelated account.
        allowed_assignees = {_system_owner(row), *(row.contributors or [])}
        if body.assignee_username not in allowed_assignees:
            raise HTTPException(
                422, "Assignee must be the owner or a registered contributor"
            )

        if state is None:
            state = QuestionState(
                id=new_id("QST"),
                assessment_id=assessment.id,
                system_id=system_id,
                question_key=question_key,
            )
            session.add(state)
        state.assignee_username = body.assignee_username
        state.assigned_by_username = user
        state.assigned_at = datetime.now(timezone.utc)
        system_name = row.name
        await session.commit()
        count = (await _comment_counts(session, assessment.id)).get(question_key, 0)
        answers = _answer_store(row)

    label = QUESTION_LABEL.get(question_key, question_key)
    background_tasks.add_task(
        email_sender.notify_question_assigned,
        assignee_username=body.assignee_username,
        system_name=system_name,
        system_id=system_id,
        question_label=label,
        assigned_by=user,
    )
    return QuestionStateResponse(
        question_key=question_key,
        # Per-cycle frozen answer (matches _build_state); the live system row may
        # diverge from this cycle's answer after a re-assessment (review: :999).
        # Same fallback as _build_state for a not-yet-answered state.
        answer=state.answer or _read_answer(row, answers, question_key),
        answer_source=state.answer_source,
        confidence=state.confidence,
        confirmed=bool(state.confirmed_at),
        assignee_username=state.assignee_username,
        comment_count=count,
        needs_attention=_needs_attention(row, state, state.answer),
    )


@router.delete(
    "/systems/{system_id}/assessment/questions/{question_key}/assign",
    response_model=None,
    status_code=204,
)
async def unassign_question(
    system_id: str,
    question_key: str,
    request: Request,
    _: str = Depends(require_permission(SYSTEMS_WRITE)),
):
    _validate_question_key(question_key)
    user = _current_user(request)
    async with SessionLocal() as session:
        row = await _get_system(session, system_id)
        if not _is_editable(row):
            raise HTTPException(409, "Assessment is locked and cannot be edited")
        assessment = await _ensure_assessment(session, row)
        state = await _load_state(session, assessment.id, question_key)
        if not _may_edit(row, state, user):
            raise HTTPException(403, "Only the owner or current assignee may unassign")
        if state is not None:
            state.assignee_username = None
            state.assigned_by_username = None
            state.assigned_at = None
            await session.commit()


# ── finalize / submit ────────────────────────────────────────────────────────


@router.post(
    "/systems/{system_id}/assessment/finalize",
    response_model=AssessmentStateResponse,
)
async def finalize_assessment(
    system_id: str,
    request: Request,
    _: str = Depends(require_permission(SYSTEMS_WRITE)),
):
    """Gate: every question must be OWNER-confirmed. Does not yet submit to the CO —
    the owner then reviews the submit screen and calls /submit."""
    user = _current_user(request)
    async with SessionLocal() as session:
        row = await _get_system(session, system_id)
        if user != _system_owner(row):
            raise HTTPException(403, "Only the owner may finalize the assessment")
        assessment = await _ensure_assessment(session, row)
        states = await _states_by_key(session, assessment.id)
        unconfirmed = _owner_unconfirmed(row, states)
        if unconfirmed:
            raise HTTPException(
                422,
                f"{len(unconfirmed)} question(s) still require your confirmation",
            )
        return await _build_state(session, row, user, assessment)


@router.post(
    "/systems/{system_id}/assessment/submit",
    response_model=AssessmentStateResponse,
)
async def submit_assessment(
    system_id: str,
    body: SubmitRequest,
    request: Request,
    _: str = Depends(require_permission(SYSTEMS_WRITE)),
):
    """Owner submits to the compliance officer: every question must be
    OWNER-confirmed. Atomically locks the assessment — sets both the registry
    workflow_status and the compliance Assessment.status to pending_review (shared
    DB, one transaction) so the owner's Assessments tab reflects it — and records
    the submission step."""
    user = _current_user(request)
    async with SessionLocal() as session:
        row = await _get_system(session, system_id)
        if user != _system_owner(row):
            raise HTTPException(403, "Only the owner may submit the assessment")
        if not _is_editable(row):
            raise HTTPException(409, "Assessment is already locked")
        assessment = await _current_assessment(session, system_id)
        states = await _states_by_key(session, assessment.id) if assessment else {}
        unconfirmed = _owner_unconfirmed(row, states)
        if unconfirmed:
            raise HTTPException(
                422,
                f"Cannot submit: {len(unconfirmed)} question(s) not owner-confirmed",
            )
        row.workflow_status = "pending_review"
        row.assignee_username = row.compliance_officer_username
        # Atomic cross-service write (shared DB) — advance the compliance
        # Assessment row the owner's tab reads, mirroring advance-from-classification.
        if assessment is not None:
            assessment.status = "pending_review"
        session.add(
            SystemWorkflowStep(
                id=new_id("SWS"),
                system_id=system_id,
                step="assessment_submitted",
                actor_username=user,
                assignee_username=row.compliance_officer_username,
                note=body.note,
            )
        )
        await session.commit()
        row = await _get_system(session, system_id)
        return await _build_state(session, row, user, assessment)


# ── compliance officer: issue / reject (#348) ────────────────────────────────


def _notify_recipients(row: AISystem) -> list[str]:
    """Owner + registered contributors — the people notified of a CO decision."""
    out: list[str] = []
    for uname in [_system_owner(row), *(row.contributors or [])]:
        if uname and uname not in out:
            out.append(uname)
    return out


@router.post(
    "/systems/{system_id}/assessment/issue",
    response_model=AssessmentStateResponse,
)
async def issue_classification(
    system_id: str,
    body: IssueRequest,
    request: Request,
    background_tasks: BackgroundTasks,
    _: str = Depends(require_permission(SYSTEMS_APPROVE)),
):
    """CO issues the final, binding risk classification. Only from pending_review;
    the result is immutable. The only allowed tier combo is high + transparency."""
    user = _current_user(request)
    # Enforce the combo rule: transparency may only accompany 'high'.
    if body.transparency and body.tier != "high":
        raise HTTPException(
            422, "Transparency obligations may only be issued alongside 'high' risk"
        )
    if not body.confirmed:
        raise HTTPException(422, "The confirmation checkbox must be ticked to issue")

    async with SessionLocal() as session:
        row = await _get_system(session, system_id)
        if row.workflow_status != "pending_review":
            raise HTTPException(
                409,
                f"Cannot issue from status '{row.workflow_status}' — "
                "the assessment must be submitted (locked) first",
            )
        # Loose CO model: any systems:approve user may issue. When a specific CO
        # was assigned (via the compliance "New Assessment" modal → /workflow/assign),
        # only that CO may issue; when none is assigned (e.g. the registry's direct
        # "Start assessment" path), any approver may. See CLAUDE.md — CO assignment
        # is optional by design.
        if row.compliance_officer_username and user != row.compliance_officer_username:
            raise HTTPException(
                403, "Only the assigned compliance officer may issue the classification"
            )

        row.tier = body.tier
        row.co_issued_transparency = bool(body.transparency)
        row.basis = f"Risk classification issued by compliance officer {user}."
        row.workflow_status = "approved"
        row.assignee_username = None
        assessment = await _current_assessment(session, system_id)
        if assessment is not None:
            assessment.status = "approved"
            assessment.confirmed_by = user
            # Snapshot the classification onto THIS assessment so a later re-assessment
            # (which overwrites the live system row) doesn't mutate this frozen cycle —
            # a historical "View results" reads these, not the current system row.
            assessment.tier = row.tier
            assessment.basis = row.basis
            assessment.annex_iii_area = row.annex_iii_area
            assessment.org_role = row.org_role
            assessment.co_issued_transparency = row.co_issued_transparency
            assessment.is_chatbot = row.is_chatbot
            assessment.generates_synthetic_content = row.generates_synthetic_content
            assessment.assessment_sources = row.assessment_sources
            assessment.classification_rationale = row.classification_rationale
            # Generate the governance chain (obligations + requirements) for the
            # now-final tier, in THIS transaction so it is atomic with the approve:
            # created iff the commit succeeds, and never persisted on failure.
            # Idempotent — skip if obligations already exist (a reject→resubmit→
            # re-issue cycle must not duplicate). minimal/GPAI/prohibited tiers
            # yield no obligations (obligations_for returns []), so this is a no-op.
            existing_obligations = (
                await session.execute(
                    select(func.count())
                    .select_from(Obligation)
                    .where(Obligation.assessment_id == assessment.id)
                )
            ).scalar_one()
            if existing_obligations == 0:
                created, _ = await generate_obligations_in_session(
                    session, assessment, row
                )
                if created:
                    await generate_requirements_in_session(
                        session,
                        created,
                        row.tier,
                        getattr(row, "org_role", "provider") or "provider",
                    )
        session.add(
            SystemWorkflowStep(
                id=new_id("SWS"),
                system_id=system_id,
                step="classification_issued",
                actor_username=user,
                note=body.note,
            )
        )
        recipients = _notify_recipients(row)
        system_name = row.name
        await session.commit()
        row = await _get_system(session, system_id)
        state = await _build_state(session, row, user)

    for uname in recipients:
        background_tasks.add_task(
            email_sender.notify,
            to_username=uname,
            subject=f"[{{platform_name}}] Risk classification issued for '{system_name}'",
            body=(
                f"Hi,\n\nThe compliance officer has issued the final EU AI Act risk "
                f"classification for '{system_name}' ({system_id}). The assessment is now "
                f"final.\n\n{{platform_name}}: {{registry_url}}"
            ),
        )
    logger.info(
        "assessment.classification_issued",
        extra={"system_id": system_id, "tier": body.tier, "by": user},
    )
    return state


@router.post(
    "/systems/{system_id}/assessment/reject",
    response_model=AssessmentStateResponse,
)
async def reject_assessment(
    system_id: str,
    body: RejectRequest,
    request: Request,
    background_tasks: BackgroundTasks,
    _: str = Depends(require_permission(SYSTEMS_APPROVE)),
):
    """CO returns the assessment to the owner with a mandatory comment. Backend
    records 'returned' (the owner sees it as 'under review'); the owner may
    re-open, edit, and resubmit."""
    user = _current_user(request)
    async with SessionLocal() as session:
        row = await _get_system(session, system_id)
        if row.workflow_status != "pending_review":
            raise HTTPException(
                409, f"Cannot return from status '{row.workflow_status}'"
            )
        if row.compliance_officer_username and user != row.compliance_officer_username:
            raise HTTPException(
                403, "Only the assigned compliance officer may return the assessment"
            )

        owner = _system_owner(row)
        row.workflow_status = "returned"
        row.assignee_username = owner
        assessment = await _current_assessment(session, system_id)
        if assessment is not None:
            assessment.status = "returned"
        session.add(
            SystemWorkflowStep(
                id=new_id("SWS"),
                system_id=system_id,
                step="assessment_returned",
                actor_username=user,
                assignee_username=owner,
                note=body.note,
            )
        )
        system_name = row.name
        await session.commit()
        row = await _get_system(session, system_id)
        state = await _build_state(session, row, user)

    if owner:
        background_tasks.add_task(
            email_sender.notify,
            to_username=owner,
            subject=f"[{{platform_name}}] Assessment for '{system_name}' returned for revision",
            body=(
                f"Hi,\n\nThe compliance officer has returned the assessment for "
                f"'{system_name}' ({system_id}) with comments:\n\n{body.note}\n\n"
                f"Please review, update, and resubmit.\n\n{{platform_name}}: {{registry_url}}"
            ),
        )
    logger.info("assessment.returned", extra={"system_id": system_id, "by": user})
    return state


@router.post(
    "/systems/{system_id}/assessment/start-new",
    response_model=AssessmentStateResponse,
)
async def start_new_assessment(
    system_id: str,
    request: Request,
    background_tasks: BackgroundTasks,
    _: str = Depends(require_permission(SYSTEMS_WRITE)),
):
    """Begin a fresh assessment cycle on an already-approved system.

    Archives the approved assessment (status=inactive, kept for audit) and resets
    the system's live classification (tier=pending, workflow_status=draft), then
    lazily prefills a brand-new cycle exactly like the first-ever start. The prior
    cycle's frozen question_states/answers/comments stay attached to the archived
    assessment and remain viewable read-only by id. Registry-side (shared DB) so
    the owner — who has systems:write but not assessments:approve — can start it
    without the compliance /historicize permission.

    If the current assessment is NOT approved (an in-progress cycle, or none yet),
    there is nothing to archive — this just opens that current cycle (cycles are
    sequential, so there is only ever one active). A fresh cycle is created only
    when the current one is approved."""
    user = _current_user(request)
    async with SessionLocal() as session:
        row = await _get_system(session, system_id)
        if user != _system_owner(row):
            raise HTTPException(403, "Only the owner may start a new assessment")
        current = await _current_assessment(session, system_id)
        if current is None or current.status != "approved":
            # Nothing to archive — fall through to opening the current (or a
            # freshly-ensured) cycle. Point "Start new" at the in-progress one.
            return await open_assessment(system_id, request, background_tasks)
        # Archive the approved cycle (frozen; its states/comments stay attached).
        current.status = "inactive"
        current.updated_at = datetime.now(timezone.utc)
        # Reset the live classification so the fresh cycle re-prefills from scratch.
        # Mirror compliance /historicize (tier=pending, workflow=draft); the other
        # fields are reset to their column defaults — basis is NOT NULL (""),
        # co_issued_transparency NOT NULL (False); the JSONB/int fields are nullable.
        row.tier = "pending"
        row.workflow_status = "draft"
        row.basis = ""
        row.annex_iii_area = None
        row.co_issued_transparency = False
        row.classification_rationale = None
        row.assessment_sources = None
        row.assignee_username = None
        session.add(
            SystemWorkflowStep(
                id=new_id("SWS"),
                system_id=system_id,
                step="assessment_restarted",
                actor_username=user,
            )
        )
        await session.flush()
        # Re-sync the compliance score now the approved cycle is inactive.
        await sync_system_compliance(session, system_id)
        await session.commit()
    logger.info("assessment.restarted", extra={"system_id": system_id, "by": user})
    # Delegate to the normal open path — now that no non-inactive assessment
    # exists, it creates a fresh questionnaire_pending cycle and seeds blank states.
    return await open_assessment(system_id, request, background_tasks)
