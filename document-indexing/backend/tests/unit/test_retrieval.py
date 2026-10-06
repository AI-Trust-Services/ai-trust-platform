"""Unit tests for Reciprocal Rank Fusion — the pure fusion step of hybrid retrieval."""

from app.retrieval import rrf, rrf_scores


def test_rrf_rewards_agreement_across_channels():
    # 'b' appears high in both lists → should win over 'a' (top of one list only).
    dense = ["a", "b", "c"]
    lexical = ["b", "d", "a"]
    fused = rrf([dense, lexical])
    assert fused[0] == "b"
    assert set(fused) == {"a", "b", "c", "d"}


def test_rrf_single_channel_preserves_order():
    assert rrf([["x", "y", "z"]]) == ["x", "y", "z"]


def test_rrf_top_truncates():
    fused = rrf([["a", "b", "c", "d"]], top=2)
    assert fused == ["a", "b"]


def test_rrf_empty():
    assert rrf([]) == []
    assert rrf([[], []]) == []


def test_rrf_scores_sum_contributions_across_channels():
    # 'b' is rank 0 in dense and rank 1 in lexical: 1/61 + 1/62.
    scores = rrf_scores([["b", "a"], ["c", "b"]], k=60)
    assert scores["b"] == 1.0 / 61 + 1.0 / 62
    assert scores["a"] == 1.0 / 62
    # Agreement across channels beats a single-channel top hit.
    assert scores["b"] > scores["c"]


def test_rrf_scores_respects_k():
    # Larger k flattens the rank gap between positions.
    assert rrf_scores([["x", "y"]], k=1)["x"] == 1.0 / 2
    assert rrf_scores([["x", "y"]], k=1)["y"] == 1.0 / 3


def test_rrf_scores_empty():
    assert rrf_scores([]) == {}
    assert rrf_scores([[], []]) == {}
