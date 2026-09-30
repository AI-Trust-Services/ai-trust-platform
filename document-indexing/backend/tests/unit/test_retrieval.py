"""Unit tests for Reciprocal Rank Fusion — the pure fusion step of hybrid retrieval."""

from app.retrieval import rrf


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
