"""Remove NIST AI RMF and ISO/IEC 42001 frameworks (EU AI Act only)

The platform now focuses solely on the EU AI Act. The NIST AI RMF and ISO/IEC
42001 frameworks seeded by migration 0003 are removed, leaving EU AI Act as the
only compliance framework.

`assessments.framework_id` and `obligations.framework_id` reference `frameworks.id`
with no ``ondelete``, so any dependent rows must be deleted before the framework
rows. Obligations are also cascade-deleted when their parent assessment is removed,
but we delete them explicitly first so the migration is safe regardless of which
rows exist. In practice an EU-only deployment has no NIST/ISO assessments.

Revision ID: 0038
Revises: 0037
Create Date: 2026-10-12
"""

from datetime import datetime, timezone

import sqlalchemy as sa
from alembic import op

revision = "0038"
down_revision = "0037"
branch_labels = None
depends_on = None

_REMOVED_IDS = ("FRM-NIST-AI-RMF", "FRM-ISO-42001")

# Re-seeded on downgrade. Mirrors the entries removed from _SEED_FRAMEWORKS in
# 0003_compliance.py.
_RESTORE_FRAMEWORKS = [
    {
        "id": "FRM-NIST-AI-RMF",
        "name": "NIST AI RMF",
        "version": "1.0 (2023)",
        "description": "NIST AI Risk Management Framework. Voluntary framework organised around GOVERN, MAP, MEASURE, and MANAGE functions.",
        "enabled": True,
    },
    {
        "id": "FRM-ISO-42001",
        "name": "ISO/IEC 42001",
        "version": "2023",
        "description": "International standard for AI management systems (AIMS). Requirements for establishing, implementing, and improving an AI management system.",
        "enabled": True,
    },
]

_frameworks_table = sa.table(
    "frameworks",
    sa.column("id", sa.String),
    sa.column("name", sa.String),
    sa.column("version", sa.String),
    sa.column("description", sa.Text),
    sa.column("enabled", sa.Boolean),
    sa.column("created_at", sa.DateTime(timezone=True)),
)


def upgrade() -> None:
    bind = op.get_bind()
    # Remove dependents first (no ondelete on framework_id FKs), then the rows.
    for table in ("obligations", "assessments"):
        bind.execute(
            sa.text(f"DELETE FROM {table} WHERE framework_id IN :ids").bindparams(
                sa.bindparam("ids", list(_REMOVED_IDS), expanding=True)
            )
        )
    bind.execute(
        sa.text("DELETE FROM frameworks WHERE id IN :ids").bindparams(
            sa.bindparam("ids", list(_REMOVED_IDS), expanding=True)
        )
    )


def downgrade() -> None:
    now = datetime.now(timezone.utc)
    op.bulk_insert(
        _frameworks_table,
        [{**f, "created_at": now} for f in _RESTORE_FRAMEWORKS],
    )
