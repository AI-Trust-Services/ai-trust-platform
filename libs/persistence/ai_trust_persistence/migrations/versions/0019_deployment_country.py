"""Add deployment_country and EU-presence questions to ai_systems

Revision ID: 0019
Revises: 0018
Create Date: 2026-09-09

Captured at registration: the country the AI system is deployed in (ISO 3166-1
alpha-2) plus two universal EU-presence questions — whether the output is used
in the EU and whether the system is placed on the EU market. All three are
nullable so existing rows (registered before this field existed) stay valid.
"""
from alembic import op
import sqlalchemy as sa

revision = "0019"
down_revision = "0018"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("ai_systems", sa.Column("deployment_country", sa.String(2), nullable=True))
    op.add_column("ai_systems", sa.Column("eu_output_usage", sa.Boolean(), nullable=True))
    op.add_column("ai_systems", sa.Column("eu_market_placement", sa.Boolean(), nullable=True))


def downgrade() -> None:
    op.drop_column("ai_systems", "eu_market_placement")
    op.drop_column("ai_systems", "eu_output_usage")
    op.drop_column("ai_systems", "deployment_country")
