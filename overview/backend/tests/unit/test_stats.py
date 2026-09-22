"""Unit tests for overview stats — pure logic, no DB required."""
from __future__ import annotations


def test_tier_distribution_sums_correctly():
    by_tier = {"minimal": 5, "limited": 3, "high": 2, "prohibited": 0}
    assert sum(by_tier.values()) == 10


def test_compliance_average_rounds_to_one_decimal():
    values = [100.0, 50.0, 75.0]
    avg = round(sum(values) / len(values), 1)
    assert avg == 75.0


def test_empty_tier_distribution():
    by_tier = {}
    assert sum(by_tier.values()) == 0


def test_fully_compliant_count():
    compliances = [100.0, 80.0, 100.0, 0.0]
    fully_compliant = sum(1 for c in compliances if c >= 100)
    assert fully_compliant == 2
