"""Single-page EU AI Act assessment endpoints (issues #346 / #314).

The owner-facing assessment flow: open (AI prefill + classification), read the
full state (start page + sidebar), per-question autosave / confirm / comment /
assign, finalize, and submit to the compliance officer. Replaces the
section-sequenced questionnaire modal flow.

All routes are per-system and `ai`-registration-mode oriented. Each route owns
its transaction (``async with SessionLocal()``), per the repo convention.
"""

from __future__ import annotations

import os
from datetime import datetime, timezone

import httpx
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request
from sqlalchemy import func, select

from ai_trust_authorization import require_permission
from ai_trust_authorization.constants import (
    SYSTEMS_APPROVE,
    SYSTEMS_READ,
    SYSTEMS_WRITE,
)
from ai_trust_logging import correlation_id_var, get_logger
from ai_trust_persistence import SessionLocal
from ai_trust_persistence.models.ai_system import AISystem
from ai_trust_persistence.models.assessment import Assessment
from ai_trust_persistence.models.question_comment import QuestionComment
from ai_trust_persistence.models.question_state import QuestionState
from ai_trust_persistence.models.system_workflow_step import SystemWorkflowStep

from app import email_sender
from app.assessment_catalogue import (
    ASSESSMENT_QUESTION_KEYS,
    SYSTEM_STORAGE_KEYS,
    decisive_question_keys,
    question_catalogue,
    section_of,
)
from app.classifier import classify_ai_questionnaire
from app.ids import new_id
from app.llm import (
    LLMParseError,
    build_assessment_prefill_messages,
    chat,
    parse_json_response,
)
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
    DecisiveQuestion,
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

_INDEXING_URL = os.environ.get(
    "INDEXING_BACKEND_URL", "http://document-indexing-backend:8011"
)
_SERVICE_PRINCIPAL = os.environ.get(
    "EXTERNAL_API_SERVICE_PRINCIPAL", "svc-external-api"
)


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
    """Read a question's answer from its canonical store. System-storage business
    keys (``SYSTEM_STORAGE_KEYS``, e.g. department/use_case) live on the AISystem
    column; technical (AI-mode free-text) keys live nested under ``technical``;
    other business keys live at the top level of ``questionnaire_answers``."""
    if question_key in SYSTEM_STORAGE_KEYS:
        v = getattr(row, question_key, None)
    elif section_of(question_key) == "technical":
        tech = answers.get("technical") or {}
        v = tech.get(question_key)
    else:
        v = answers.get(question_key)
    if v is None:
        return None
    return str(v)


def _write_answer(row: AISystem, answers: dict, question_key: str, value: str) -> dict:
    """Persist a question's answer to its canonical store and return the (possibly
    updated) answers dict. System-storage keys are written to the AISystem column
    (the dict is returned unchanged for them); other keys are written into the
    section-aware ``questionnaire_answers`` dict."""
    if question_key in SYSTEM_STORAGE_KEYS:
        setattr(row, question_key, value)
        return answers
    out = dict(answers)
    if section_of(question_key) == "technical":
        tech = dict(out.get("technical") or {})
        tech[question_key] = value
        out["technical"] = tech
    else:
        out[question_key] = value
    return out


async def _states_by_key(session, system_id: str) -> dict[str, QuestionState]:
    result = await session.execute(
        select(QuestionState).where(QuestionState.system_id == system_id)
    )
    return {s.question_key: s for s in result.scalars().all()}


async def _comment_counts(session, system_id: str) -> dict[str, int]:
    # SQL aggregate (count per question_key) — avoids loading full comment rows
    # (incl. body text) into memory just to count them.
    result = await session.execute(
        select(QuestionComment.question_key, func.count().label("n"))
        .where(
            QuestionComment.system_id == system_id,
            QuestionComment.deleted_at.is_(None),
        )
        .group_by(QuestionComment.question_key)
    )
    return {row.question_key: row.n for row in result.all()}


def _needs_attention(
    row: AISystem, state: QuestionState | None, answer: str | None
) -> bool:
    """A question needs the owner's attention when it is low-confidence OR the AI
    could not pre-fill it (empty answer) — AND it has not yet been owner-confirmed.
    Confirming a question clears it from the attention count."""
    if _is_owner_confirmed(row, state):
        return False
    if state is not None and state.confidence == "low":
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


async def _ensure_assessment(session, row: AISystem) -> None:
    """Create a compliance Assessment row (questionnaire_pending) for this system
    if none exists. Idempotent; caller owns the transaction. Keeps the governance
    tables (owner's Assessments tab, /home/assessments) in sync with the
    single-page flow, and self-heals systems prefilled before this existed."""
    if await _current_assessment(session, row.id) is not None:
        return
    session.add(
        Assessment(
            id=new_id("ASS"),
            ai_system_id=row.id,
            framework_id=_EU_AI_ACT_FRAMEWORK_ID,
            title=f"EU AI Act Assessment — {row.name}",
            status="questionnaire_pending",
        )
    )


async def _retrieve_context(
    system_id: str,
) -> tuple[str, list[SourceDocumentRef]]:
    """Fetch top document passages for prefill. Returns (context_block, sources).

    Fails soft: if indexing is unreachable or returns nothing, returns an empty
    block and an empty source list (prefill then proposes low-confidence /
    empty answers)."""
    payload = {"ai_system_id": system_id, "query": "EU AI Act classification", "k": 12}
    headers = {"x-forwarded-preferred-username": _SERVICE_PRINCIPAL}
    cid = correlation_id_var.get("")
    if cid:
        headers["x-correlation-id"] = cid
    url = f"{_INDEXING_URL}/v1/retrieve"
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(url, json=payload, headers=headers)
        if resp.status_code >= 400:
            logger.warning(
                "assessment.retrieve_failed", extra={"status": resp.status_code}
            )
            return "", []
        data = resp.json()
    except (httpx.TimeoutException, httpx.RequestError, ValueError) as exc:
        logger.warning("assessment.retrieve_unreachable", extra={"error": str(exc)})
        return "", []

    # /v1/retrieve returns a bare JSON array of passages (response_model=
    # list[RetrievedPassage]). Tolerate an object wrapper too, defensively.
    if isinstance(data, dict):
        results = data.get("results") or data.get("passages") or []
    elif isinstance(data, list):
        results = data
    else:
        results = []
    passages: list[str] = []
    sources: dict[tuple[str, int | None], SourceDocumentRef] = {}
    for r in results:
        passage = r.get("passage") or ""
        src = r.get("source") or {}
        name = src.get("filename") or "document"
        page = src.get("page")
        if passage:
            loc = f" (p. {page})" if page is not None else ""
            passages.append(f"[{name}{loc}] {passage}")
        key = (name, page)
        if key not in sources:
            sources[key] = SourceDocumentRef(name=name, page=page)
    return "\n\n".join(passages), list(sources.values())


# ── open / prefill ─────────────────────────────────────────────────────────


@router.post(
    "/systems/{system_id}/assessment/open",
    response_model=AssessmentStateResponse,
)
async def open_assessment(
    system_id: str,
    request: Request,
    _: str = Depends(require_permission(SYSTEMS_WRITE)),
):
    """Lazily prefill + classify on first open; return cached state thereafter.

    One batched LLM call proposes an answer + confidence per question from the
    system's indexed documents, then the deterministic classifier derives the
    tier. Seeds ``question_states`` and persists answers. Idempotent: once
    ``question_states`` rows exist, this is a plain read."""
    async with SessionLocal() as session:
        row = await _get_system(session, system_id)
        existing = await _states_by_key(session, system_id)
        if existing:
            # Self-heal: ensure the compliance Assessment row exists even for
            # systems prefilled before that creation was added (idempotent).
            await _ensure_assessment(session, row)
            await session.commit()
            return await _build_state(session, row, _current_user(request))

        # ── prefill pass (one batched LLM call) ──
        context_block, sources = await _retrieve_context(system_id)
        messages = build_assessment_prefill_messages(
            question_catalogue(), retrieved_context=context_block
        )
        try:
            result = await chat(messages, json_mode=True, task="assessment_prefill")
            parsed = await parse_json_response(
                result["text"], task="assessment_prefill"
            )
            # Validate the shape here (inside the handler): a syntactically valid
            # but schema-invalid payload (e.g. a top-level array, or answers as a
            # string) must surface as the 502 AI-unavailable response, not a 500.
            if not isinstance(parsed, dict):
                raise ValueError("prefill response is not a JSON object")
            raw_answers = parsed.get("answers") or []
            if not isinstance(raw_answers, list):
                raise ValueError("prefill 'answers' is not a list")
            prefilled = {
                a["question_key"]: a
                for a in raw_answers
                if isinstance(a, dict) and "question_key" in a
            }
        except (LLMParseError, Exception) as exc:  # noqa: BLE001
            logger.error("assessment.prefill_failed", extra={"error": str(exc)})
            raise HTTPException(status_code=502, detail=_AI_UNAVAILABLE) from exc

        answers = _answer_store(row)
        for q_key in ASSESSMENT_QUESTION_KEYS:
            proposal = prefilled.get(q_key) or {}
            ans = (proposal.get("answer") or "").strip()
            conf = proposal.get("confidence")
            if conf not in ("high", "medium", "low"):
                conf = "low"
            if ans:
                answers = _write_answer(row, answers, q_key, ans)
            session.add(
                QuestionState(
                    id=new_id("QST"),
                    system_id=system_id,
                    question_key=q_key,
                    answer_source="ai_prefilled",
                    ai_original_answer=ans or None,
                    confidence=conf,
                )
            )
        row.questionnaire_answers = answers

        # ── classification (tier) — deterministic over the LLM-inferred flags ──
        try:
            classification, rationale = await classify_ai_questionnaire(row)
        except (LLMParseError, Exception) as exc:  # noqa: BLE001
            logger.error("assessment.classify_failed", extra={"error": str(exc)})
            raise HTTPException(status_code=502, detail=_AI_UNAVAILABLE) from exc
        row.tier = classification.tier
        row.basis = classification.basis
        row.annex_iii_area = classification.annex_iii_area
        row.classification_rationale = rationale
        if rationale.get("org_role"):
            row.org_role = rationale["org_role"]
        # Persist the source passages (filename + page) that informed the prefill,
        # so the start page / confidence modal / CO panel can cite them with pages.
        row.assessment_sources = [s.model_dump() for s in sources]

        # Ensure a compliance Assessment record exists so the governance tables
        # (owner's Assessments tab, /home/assessments) reflect this assessment.
        await _ensure_assessment(session, row)

        await session.commit()
        logger.info(
            "assessment.opened",
            extra={"system_id": system_id, "tier": row.tier},
        )
        row = await _get_system(session, system_id)
        return await _build_state(session, row, _current_user(request))


async def _build_state(
    session, row: AISystem, user: str | None = None
) -> AssessmentStateResponse:
    states = await _states_by_key(session, row.id)
    counts = await _comment_counts(session, row.id)
    answers = _answer_store(row)
    editable = _is_editable(row)

    conf = ConfidenceCounts()
    attention = 0
    questions: list[QuestionStateResponse] = []
    for q_key in ASSESSMENT_QUESTION_KEYS:
        st = states.get(q_key)
        ans = _read_answer(row, answers, q_key)
        if st is not None and st.confidence == "high":
            conf.high += 1
        elif st is not None and st.confidence == "medium":
            conf.medium += 1
        elif st is not None and st.confidence == "low":
            conf.low += 1
        needs = _needs_attention(row, st, ans)
        if needs:
            attention += 1
        # Per-question edit right for the requesting user — only meaningful while
        # the assessment is editable (not locked/approved).
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
                needs_attention=needs,
                can_edit=can_edit,
            )
        )

    rationale = row.classification_rationale or {}
    fired = [
        f.get("flag")
        for f in (rationale.get("flags") or [])
        if isinstance(f, dict) and f.get("value")
    ]
    decisive = []
    for q_key in decisive_question_keys([f for f in fired if f]):
        decisive.append(
            DecisiveQuestion(
                section=section_of(q_key),
                question_key=q_key,
                question_label=QUESTION_LABEL.get(q_key, q_key),
                answer=_read_answer(row, answers, q_key),
            )
        )

    # Source documents that informed the classification (assessment-level).
    # Prefer the persisted retrieval sources (they carry page numbers); fall back
    # to the registration document names when no prefill sources were captured.
    if row.assessment_sources:
        source_docs = [
            SourceDocumentRef(name=s.get("name", "document"), page=s.get("page"))
            for s in row.assessment_sources
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
        system_name=row.name,
        registration_mode=row.registration_mode,
        owner_username=_system_owner(row),
        workflow_status=row.workflow_status,
        status_label=_status_label(row),
        editable=editable,
        tier=row.tier,
        basis=row.basis,
        org_role=row.org_role,
        reasoning=rationale.get("reasoning"),
        transparency=row.tier == "high"
        and bool(
            row.co_issued_transparency
            or row.is_chatbot
            or row.generates_synthetic_content
        ),
        confidence_counts=conf,
        attention_count=attention,
        decisive_questions=decisive,
        source_documents=source_docs,
        questions=questions,
        contributors=contributor_refs,
        prefilled=bool(states),
    )


@router.get(
    "/systems/{system_id}/assessment/state",
    response_model=AssessmentStateResponse,
)
async def get_assessment_state(
    system_id: str,
    request: Request,
    _: str = Depends(require_permission(SYSTEMS_READ)),
):
    async with SessionLocal() as session:
        row = await _get_system(session, system_id)
        return await _build_state(session, row, _current_user(request))


# ── per-question: answer / confirm ───────────────────────────────────────────


async def _load_state(session, system_id: str, question_key: str) -> QuestionState:
    result = await session.execute(
        select(QuestionState).where(
            QuestionState.system_id == system_id,
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
        state = await _load_state(session, system_id, question_key)
        if not _may_edit(row, state, user):
            raise HTTPException(403, "You are not assigned to this question")

        # Capture the previous stored value BEFORE overwriting, so we can detect a
        # genuine change (not just a change from the AI original).
        prev = (_read_answer(row, _answer_store(row), question_key) or "").strip()
        new = body.answer.strip()
        answers = _write_answer(row, _answer_store(row), question_key, body.answer)
        row.questionnaire_answers = answers

        now = datetime.now(timezone.utc)
        if state is None:
            state = QuestionState(
                id=new_id("QST"),
                system_id=system_id,
                question_key=question_key,
                answer_source="manual",
                ai_original_answer=None,
                answer_changed_at=now,
            )
            session.add(state)
        elif new != prev:
            # A genuine change: record when it happened (drives the mandatory-
            # comment-on-change gate) and revert any prior confirmation (re-edit ⇒
            # Incomplete — including a revert back to the AI original). answer_source
            # reflects whether the current value differs from the AI's proposal.
            state.answer_changed_at = now
            state.confirmed_at = None
            state.confirmed_by = None
            state.answer_source = (
                "manual"
                if new != (state.ai_original_answer or "").strip()
                else "ai_prefilled"
            )
        # No change ⇒ leave state untouched.
        await session.commit()
        count = (await _comment_counts(session, system_id)).get(question_key, 0)
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
        state = await _load_state(session, system_id, question_key)
        if state is None:
            raise HTTPException(404, "Question has no state; open the assessment first")
        if not _may_edit(row, state, user):
            raise HTTPException(403, "You are not assigned to this question")

        answers = _answer_store(row)
        current = (_read_answer(row, answers, question_key) or "").strip()
        changed = (
            state.answer_source == "manual"
            and current != (state.ai_original_answer or "").strip()
        )
        if changed:
            # Require a non-deleted comment recorded AT/AFTER the answer change —
            # not merely that some comment exists (which an unrelated earlier
            # comment would satisfy). answer_changed_at is set by save_answer on a
            # genuine change; if it is somehow NULL, fall back to any-comment.
            q = select(QuestionComment).where(
                QuestionComment.system_id == system_id,
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
        state = await _load_state(session, system_id, question_key)
        if state is None:
            raise HTTPException(404, "Question has no state")
        if not _may_edit(row, state, user):
            raise HTTPException(403, "You are not assigned to this question")
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
    _: str = Depends(require_permission(SYSTEMS_READ)),
):
    _validate_question_key(question_key)
    async with SessionLocal() as session:
        result = await session.execute(
            select(QuestionComment)
            .where(
                QuestionComment.system_id == system_id,
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
        state = await _load_state(session, system_id, question_key)
        # Commenting follows the same edit right as the answer: owner any, an
        # assignee only their own question (mirrors can_edit / the UI gate).
        if not _may_edit(row, state, user):
            raise HTTPException(403, "You are not assigned to this question")
        comment = QuestionComment(
            id=new_id("QCM"),
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
        result = await session.execute(
            select(QuestionComment).where(
                QuestionComment.id == comment_id,
                QuestionComment.system_id == system_id,
                # Enforce the nested resource path: a comment id from a different
                # question on the same system must not be deletable via this URL.
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
        state = await _load_state(session, system_id, question_key)
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
                system_id=system_id,
                question_key=question_key,
            )
            session.add(state)
        state.assignee_username = body.assignee_username
        state.assigned_by_username = user
        state.assigned_at = datetime.now(timezone.utc)
        system_name = row.name
        await session.commit()
        count = (await _comment_counts(session, system_id)).get(question_key, 0)
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
        answer=_read_answer(row, answers, question_key),
        answer_source=state.answer_source,
        confidence=state.confidence,
        confirmed=bool(state.confirmed_at),
        assignee_username=state.assignee_username,
        comment_count=count,
        needs_attention=_needs_attention(
            row, state, _read_answer(row, answers, question_key)
        ),
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
        state = await _load_state(session, system_id, question_key)
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
        states = await _states_by_key(session, system_id)
        unconfirmed = _owner_unconfirmed(row, states)
        if unconfirmed:
            raise HTTPException(
                422,
                f"{len(unconfirmed)} question(s) still require your confirmation",
            )
        return await _build_state(session, row, user)


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
        states = await _states_by_key(session, system_id)
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
        assessment = await _current_assessment(session, system_id)
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
        return await _build_state(session, row, user)


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
