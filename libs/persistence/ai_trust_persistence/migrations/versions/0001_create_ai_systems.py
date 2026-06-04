"""create ai_systems table

Revision ID: 0001
Revises:
Create Date: 2026-06-02
"""
from alembic import op
import sqlalchemy as sa

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "ai_systems",
        sa.Column("id", sa.String(20), primary_key=True),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("version", sa.String(50), nullable=False, server_default="1.0.0"),
        sa.Column("provider", sa.String(200), nullable=False, server_default=""),
        sa.Column("org_name", sa.String(200), nullable=False, server_default=""),
        sa.Column("org_role", sa.String(30), nullable=False, server_default="provider"),
        sa.Column("description", sa.Text, nullable=False, server_default=""),
        sa.Column("intended_purpose", sa.Text, nullable=False, server_default=""),
        sa.Column("system_type", sa.String(30), nullable=False, server_default="application"),
        sa.Column("autonomy_level", sa.String(50), nullable=False, server_default="decision_support"),
        sa.Column("application_url", sa.String(500), nullable=False, server_default=""),
        sa.Column("provider_country", sa.String(5), nullable=False, server_default="DE"),
        sa.Column("tier", sa.String(30), nullable=False),
        sa.Column("basis", sa.Text, nullable=False, server_default=""),
        sa.Column("annex_iii_area", sa.Integer, nullable=True),
        sa.Column("lifecycle", sa.String(30), nullable=False, server_default="development"),
        sa.Column("compliance", sa.Float, nullable=False, server_default="0"),
        sa.Column("subliminal_manipulation", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("exploits_vulnerability", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("social_scoring_public", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("real_time_biometric_public", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("emotion_recognition_workplace", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("untargeted_facial_scraping", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("predictive_policing", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("biometric_categorisation_sensitive", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("is_biometric_identification", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("is_critical_infrastructure", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("is_education_related", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("is_employment_related", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("is_credit_scoring", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("is_public_service", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("is_law_enforcement", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("is_migration", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("is_judicial_admin", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("is_gpai", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("training_compute_flops", sa.Float, nullable=False, server_default="0"),
        sa.Column("is_chatbot", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("generates_synthetic_content", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_ai_systems_name", "ai_systems", ["name"])
    op.create_index("ix_ai_systems_tier", "ai_systems", ["tier"])
    op.create_index("ix_ai_systems_lifecycle", "ai_systems", ["lifecycle"])


def downgrade() -> None:
    op.drop_table("ai_systems")
