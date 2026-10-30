"""Registration redesign: add planned_rollout_date + contributors, drop dead columns

Adds the new registration fields (``planned_rollout_date``, ``contributors``) and
removes columns no longer collected by the redesigned registration form:
``technical_owners`` (replaced by owner + contributors), ``application_url`` (replaced
by ``git_repo_url``), and the two EU-presence booleans ``eu_output_usage`` /
``eu_market_placement`` (the framework recommendation is now unconditional).

Revision ID: 0039
Revises: 0038
Create Date: 2026-10-20
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0039"
down_revision = "0038"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "ai_systems",
        sa.Column("planned_rollout_date", sa.Date(), nullable=True),
    )
    op.add_column(
        "ai_systems",
        sa.Column("contributors", postgresql.JSONB(), nullable=True),
    )
    op.drop_column("ai_systems", "technical_owners")
    op.drop_column("ai_systems", "application_url")
    op.drop_column("ai_systems", "eu_output_usage")
    op.drop_column("ai_systems", "eu_market_placement")


def downgrade() -> None:
    op.add_column(
        "ai_systems",
        sa.Column("eu_market_placement", sa.Boolean(), nullable=True),
    )
    op.add_column(
        "ai_systems",
        sa.Column("eu_output_usage", sa.Boolean(), nullable=True),
    )
    op.add_column(
        "ai_systems",
        sa.Column(
            "application_url",
            sa.String(500),
            nullable=False,
            server_default="",
        ),
    )
    op.add_column(
        "ai_systems",
        sa.Column("technical_owners", sa.Text(), nullable=True),
    )
    op.drop_column("ai_systems", "contributors")
    op.drop_column("ai_systems", "planned_rollout_date")
