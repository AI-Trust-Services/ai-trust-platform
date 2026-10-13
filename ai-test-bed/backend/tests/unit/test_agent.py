"""Unit tests for the knowledge-grounded task agent.

Tests:
- output_validator logic (empty retrieval → ModelRetry; unresolved ref → review flag;
  review_questions coerces review_required)
- citations ref_id assignment and format_passage_block
- retrieval backend dispatch with httpx mocked
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import httpx
import pytest
from pydantic_ai import ModelRetry

from app.agent.citations import assign_ref_id, format_passage_block, register_passages
from app.agent.models import SourceReference, TaskResult
from app.agent.retrieval_backends import (
    ClassicRagBackend,
    GraphBackend,
    HierarchicalBackend,
    get_backend,
)
from app.agent.task_agent import validate_task_result

# ---------------------------------------------------------------------------
# Output validator tests
# ---------------------------------------------------------------------------


def test_validate_empty_retrieved_raises_model_retry():
    """Empty retrieved dict must raise ModelRetry (agent has not called any tool)."""
    result = TaskResult(
        proposed_answer="High risk",
        rationale="Because of Annex III.",
    )
    with pytest.raises(ModelRetry):
        validate_task_result({}, result)


def test_validate_unresolved_ref_sets_review_flag():
    """A source_reference whose ref_id is not in retrieved must trigger review_required."""
    retrieved = {"L-abc": {"ref_id": "L-abc", "text": "some text"}}
    result = TaskResult(
        proposed_answer="High risk",
        rationale="See L-abc and L-UNKNOWN.",
        source_references=[
            SourceReference(ref_id="L-abc"),
            SourceReference(ref_id="L-UNKNOWN"),  # not in retrieved
        ],
    )
    amended = validate_task_result(retrieved, result)
    assert amended.review_required is True
    assert any("L-UNKNOWN" in q for q in amended.review_questions)


def test_validate_review_questions_coerces_review_required():
    """Non-empty review_questions must force review_required=True even if it was False."""
    retrieved = {"L-abc": {"ref_id": "L-abc", "text": "some text"}}
    result = TaskResult(
        proposed_answer="Limited risk",
        rationale="Only Art. 50 applies.",
        review_required=False,
        review_questions=["Is the system a chatbot under Art. 50?"],
    )
    amended = validate_task_result(retrieved, result)
    assert amended.review_required is True


def test_validate_clean_result_unchanged():
    """A result with all refs resolved and no review_questions is returned unchanged."""
    retrieved = {"L-abc": {"ref_id": "L-abc", "text": "text"}}
    result = TaskResult(
        proposed_answer="Minimal risk",
        rationale="No Annex III trigger.",
        source_references=[SourceReference(ref_id="L-abc")],
    )
    amended = validate_task_result(retrieved, result)
    assert amended.review_required is False
    assert amended.review_questions == []


def test_validate_multiple_unresolved_refs_in_one_review_question():
    """All unresolved ref_ids should appear in the same review question."""
    retrieved = {"L-real": {"ref_id": "L-real", "text": "real passage"}}
    result = TaskResult(
        proposed_answer="High risk",
        rationale="See L-real, L-fake1, L-fake2.",
        source_references=[
            SourceReference(ref_id="L-real"),
            SourceReference(ref_id="L-fake1"),
            SourceReference(ref_id="L-fake2"),
        ],
    )
    amended = validate_task_result(retrieved, result)
    assert amended.review_required is True
    combined = " ".join(amended.review_questions)
    assert "L-fake1" in combined
    assert "L-fake2" in combined


# ---------------------------------------------------------------------------
# Citations tests
# ---------------------------------------------------------------------------


def test_assign_ref_id_uses_chunk_id():
    passage = {
        "source_label": "legal",
        "meta": {"chunk_id": "chunk-42", "node_id": ""},
    }
    assert assign_ref_id(passage, 0) == "L-chunk-42"


def test_assign_ref_id_uses_node_id_fallback():
    passage = {
        "source_label": "reviewed_judgments",
        "meta": {"chunk_id": "", "node_id": "node-99"},
    }
    assert assign_ref_id(passage, 0) == "J-node-99"


def test_assign_ref_id_uses_index_fallback():
    passage = {
        "source_label": "system_evidence",
        "meta": {},
    }
    assert assign_ref_id(passage, 7) == "S-0007"


def test_assign_ref_id_unknown_label():
    passage = {
        "source_label": "other",
        "meta": {"chunk_id": "cid"},
    }
    assert assign_ref_id(passage, 0) == "X-cid"


def test_register_passages_deduplicates():
    passage = {
        "source_label": "legal",
        "text": "text A",
        "meta": {"chunk_id": "same"},
    }
    retrieved: dict = {}
    inserted1 = register_passages(retrieved, [passage])
    inserted2 = register_passages(retrieved, [passage])
    assert len(inserted1) == 1
    assert len(inserted2) == 0  # duplicate skipped
    assert len(retrieved) == 1


def test_format_passage_block_empty():
    assert format_passage_block([]) == ""


def test_format_passage_block_includes_ref_id():
    passages = [
        {
            "ref_id": "L-chunk1",
            "text": "High-risk systems in Annex III.",
            "source_label": "legal",
            "meta": {"source": {"filename": "eu_ai_act.pdf", "page": 5}},
        }
    ]
    block = format_passage_block(passages)
    assert "L-chunk1" in block
    assert "eu_ai_act.pdf" in block
    assert "High-risk systems in Annex III." in block


# ---------------------------------------------------------------------------
# Retrieval backend tests (httpx mocked)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_classic_rag_backend_returns_normalised_passages():
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = [
        {
            "chunk_id": "c1",
            "passage": "Article 6 text.",
            "rank": 1,
            "source": {"filename": "eu_ai_act.pdf", "page": 10},
            "dense_score": 0.9,
            "fts_score": 0.8,
            "rrf_score": 0.85,
        }
    ]

    mock_client = AsyncMock(spec=httpx.AsyncClient)
    mock_client.post.return_value = mock_response

    backend = ClassicRagBackend()
    passages = await backend.retrieve(
        "legal",
        "What is high-risk?",
        system_id="__eu_ai_act__",
        client=mock_client,
        username="test-user",
        k=5,
        mode="hybrid",
        rrf_k=60,
    )

    assert len(passages) == 1
    assert passages[0]["text"] == "Article 6 text."
    assert passages[0]["backend"] == "classic"
    assert passages[0]["source_label"] == "legal"
    assert passages[0]["meta"]["chunk_id"] == "c1"


@pytest.mark.asyncio
async def test_classic_rag_backend_graceful_on_error():
    mock_client = AsyncMock(spec=httpx.AsyncClient)
    mock_client.post.side_effect = httpx.ConnectError("connection refused")

    backend = ClassicRagBackend()
    passages = await backend.retrieve(
        "legal",
        "test",
        system_id="__eu_ai_act__",
        client=mock_client,
        username="test-user",
        k=5,
        mode="hybrid",
        rrf_k=60,
    )
    assert passages == []


@pytest.mark.asyncio
async def test_classic_rag_backend_graceful_on_non_200():
    mock_response = MagicMock()
    mock_response.status_code = 503

    mock_client = AsyncMock(spec=httpx.AsyncClient)
    mock_client.post.return_value = mock_response

    backend = ClassicRagBackend()
    passages = await backend.retrieve(
        "legal",
        "test",
        system_id="__eu_ai_act__",
        client=mock_client,
        username="test-user",
        k=5,
        mode="hybrid",
        rrf_k=60,
    )
    assert passages == []


@pytest.mark.asyncio
async def test_graph_backend_returns_normalised_passages():
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = [
        {"text": "Employment screening precedent.", "node_id": "n1", "score": 0.95}
    ]

    mock_client = AsyncMock(spec=httpx.AsyncClient)
    mock_client.post.return_value = mock_response

    backend = GraphBackend()
    passages = await backend.retrieve(
        "reviewed_judgments",
        "employment screening classification",
        system_id="__reviewed_judgments__",
        client=mock_client,
        username="test-user",
        k=3,
        mode="hybrid",
        rrf_k=60,
    )

    assert len(passages) == 1
    assert passages[0]["text"] == "Employment screening precedent."
    assert passages[0]["backend"] == "graph"
    assert passages[0]["meta"]["node_id"] == "n1"


@pytest.mark.asyncio
async def test_hierarchical_backend_returns_empty_and_logs(caplog):
    import logging

    backend = HierarchicalBackend()
    with caplog.at_level(logging.INFO):
        passages = await backend.retrieve(
            "system_evidence",
            "test question",
            system_id="SYS-TEST",
            client=None,  # type: ignore[arg-type]
            username="test",
            k=5,
            mode="hybrid",
            rrf_k=60,
        )
    assert passages == []


@pytest.mark.asyncio
async def test_get_backend_raises_for_unknown():
    with pytest.raises(ValueError, match="Unknown retrieval backend"):
        get_backend("nonexistent")


@pytest.mark.asyncio
async def test_get_backend_classic():
    assert isinstance(get_backend("classic"), ClassicRagBackend)


# ---------------------------------------------------------------------------
# Unused imports reference — keep for type clarity
# ---------------------------------------------------------------------------
_refs = (AppliedJudgment,)  # ensures the import isn't flagged as unused
