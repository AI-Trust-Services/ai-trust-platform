"""Verify that migration 0007 created all expected indexes.

Queries pg_indexes (a Postgres system catalog view) directly — no application
logic, just schema assertions. Runs as part of the e2e suite because it needs
a live Postgres connection with the migrations applied.
"""
from __future__ import annotations

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from tests.e2e.conftest import _test_engine


# ---------------------------------------------------------------------------
# Expected indexes from migration 0007_indexes.py
# ---------------------------------------------------------------------------

EXPECTED = [
    # M2M reverse indexes
    ("control_obligations", "ix_control_obligations_obligation_id"),
    ("evidence_controls",   "ix_evidence_controls_control_id"),
    ("evidence_obligations","ix_evidence_obligations_obligation_id"),
    # Composite hot-path indexes
    ("assessments",         "ix_assessments_system_status"),
    ("obligations",         "ix_obligations_assessment_status"),
    # Single-column misses
    ("evidence",            "ix_evidence_validity_until"),
    ("assessments",         "ix_assessments_updated_at"),
    ("obligations",         "ix_obligations_article_ref"),
]


@pytest.mark.asyncio
async def test_migration_0007_indexes_exist():
    """Every index defined in 0007_indexes.py must be present in pg_indexes."""
    async with AsyncSession(_test_engine) as session:
        result = await session.execute(
            text(
                "SELECT tablename, indexname "
                "FROM pg_indexes "
                "WHERE schemaname = 'public'"
            )
        )
        existing = {(row.tablename, row.indexname) for row in result}

    missing = [(t, i) for t, i in EXPECTED if (t, i) not in existing]
    assert not missing, (
        "The following indexes from migration 0007 are missing in the DB:\n"
        + "\n".join(f"  {t}.{i}" for t, i in missing)
    )


@pytest.mark.asyncio
async def test_m2m_reverse_index_columns():
    """Each reverse index must cover the correct column."""
    expected_columns = {
        "ix_control_obligations_obligation_id": "obligation_id",
        "ix_evidence_controls_control_id":      "control_id",
        "ix_evidence_obligations_obligation_id":"obligation_id",
    }

    async with AsyncSession(_test_engine) as session:
        result = await session.execute(
            text(
                "SELECT i.relname AS index_name, a.attname AS column_name "
                "FROM pg_class i "
                "JOIN pg_index ix ON ix.indexrelid = i.oid "
                "JOIN pg_attribute a ON a.attrelid = ix.indrelid "
                "  AND a.attnum = ANY(ix.indkey) "
                "WHERE i.relname = ANY(:names)",
            ),
            {"names": list(expected_columns)},
        )
        actual = {row.index_name: row.column_name for row in result}

    for idx_name, expected_col in expected_columns.items():
        assert idx_name in actual, f"Index {idx_name!r} not found in pg_class"
        assert actual[idx_name] == expected_col, (
            f"Index {idx_name!r} covers column {actual[idx_name]!r}, "
            f"expected {expected_col!r}"
        )


@pytest.mark.asyncio
async def test_composite_index_column_order():
    """Composite indexes must have columns in the correct order (leading column first)."""
    # pg_index.indkey is an int2vector of attribute numbers in key order.
    # We check that the first column in each composite index is correct.
    expected_leading = {
        "ix_assessments_system_status":     "ai_system_id",
        "ix_obligations_assessment_status": "assessment_id",
    }

    async with AsyncSession(_test_engine) as session:
        result = await session.execute(
            text(
                "SELECT i.relname AS index_name, "
                "       a.attname AS first_column "
                "FROM pg_class i "
                "JOIN pg_index ix ON ix.indexrelid = i.oid "
                "JOIN pg_attribute a "
                "  ON a.attrelid = ix.indrelid "
                "  AND a.attnum = ( "
                "    SELECT col::int "
                "    FROM unnest(string_to_array(ix.indkey::text, ' ')) AS col "
                "    LIMIT 1 "
                "  ) "
                "WHERE i.relname = ANY(:names)",
            ),
            {"names": list(expected_leading)},
        )
        actual = {row.index_name: row.first_column for row in result}

    for idx_name, expected_col in expected_leading.items():
        assert idx_name in actual, f"Index {idx_name!r} not found"
        assert actual[idx_name] == expected_col, (
            f"Index {idx_name!r} leading column is {actual[idx_name]!r}, "
            f"expected {expected_col!r}"
        )
