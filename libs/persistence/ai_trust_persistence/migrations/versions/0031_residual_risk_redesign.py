"""residual_risk_redesign

Revision ID: 0031
Revises: 0030
Create Date: 2026-09-17
"""
from alembic import op
import sqlalchemy as sa

revision = "0031"
down_revision = "0030"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # risk_entries: add residual_status, remove risk_type
    op.add_column("risk_entries", sa.Column("residual_status", sa.String(20), server_default="none", nullable=False))
    op.drop_column("risk_entries", "risk_type")

    # risk_registers: add register-level residual risk assessment fields
    op.add_column("risk_registers", sa.Column("residual_severity", sa.String(20), nullable=True))
    op.add_column("risk_registers", sa.Column("residual_likelihood", sa.String(20), nullable=True))
    op.add_column("risk_registers", sa.Column("residual_final_risk_level", sa.String(20), nullable=True))
    op.add_column("risk_registers", sa.Column("residual_date_of_identification", sa.Date(), nullable=True))


def downgrade() -> None:
    op.add_column("risk_entries", sa.Column("risk_type", sa.String(20), server_default="known", nullable=False))
    op.drop_column("risk_entries", "residual_status")
    op.drop_column("risk_registers", "residual_severity")
    op.drop_column("risk_registers", "residual_likelihood")
    op.drop_column("risk_registers", "residual_final_risk_level")
    op.drop_column("risk_registers", "residual_date_of_identification")
