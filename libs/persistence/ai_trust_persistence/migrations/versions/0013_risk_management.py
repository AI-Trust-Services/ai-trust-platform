"""Add risk_registers, risk_entries, misuse_scenarios, mitigation_measures, reassessment_triggers

Revision ID: 0013
Revises: 0012
Create Date: 2026-09-02
"""
from alembic import op
import sqlalchemy as sa

revision = "0013"
down_revision = "0012"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Use IF NOT EXISTS so this migration is idempotent — tables may already
    # exist if migration numbering was fixed after a partial prior run.
    op.execute("""
        CREATE TABLE IF NOT EXISTS risk_registers (
            id VARCHAR(30) PRIMARY KEY,
            ai_system_id VARCHAR(20) NOT NULL REFERENCES ai_systems(id) ON DELETE CASCADE,
            status VARCHAR(30) NOT NULL DEFAULT 'draft',
            assessment_scope TEXT NOT NULL DEFAULT '',
            residual_risk_acceptable BOOLEAN,
            residual_risk_argument TEXT NOT NULL DEFAULT '',
            approver_username VARCHAR(200),
            approved_at TIMESTAMP WITH TIME ZONE,
            notes TEXT NOT NULL DEFAULT '',
            created_by VARCHAR(200) NOT NULL DEFAULT '',
            created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            last_assessment_completed_at TIMESTAMP WITH TIME ZONE
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_risk_registers_ai_system_id ON risk_registers(ai_system_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_risk_registers_status ON risk_registers(status)")

    op.execute("""
        CREATE TABLE IF NOT EXISTS risk_entries (
            id VARCHAR(30) PRIMARY KEY,
            register_id VARCHAR(30) NOT NULL REFERENCES risk_registers(id) ON DELETE CASCADE,
            title VARCHAR(300) NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            category VARCHAR(100) NOT NULL DEFAULT '',
            article_9_step VARCHAR(20) NOT NULL DEFAULT '9(2)(a)',
            risk_type VARCHAR(20) NOT NULL DEFAULT 'known',
            severity VARCHAR(20) NOT NULL DEFAULT 'medium',
            likelihood VARCHAR(20) NOT NULL DEFAULT 'possible',
            status VARCHAR(20) NOT NULL DEFAULT 'identified',
            review_notes TEXT NOT NULL DEFAULT '',
            affects_vulnerable_groups BOOLEAN NOT NULL DEFAULT false,
            vulnerable_groups TEXT NOT NULL DEFAULT '[]',
            closure_justification TEXT NOT NULL DEFAULT '',
            risk_owner VARCHAR(200),
            ai_lifecycle_phase VARCHAR(50),
            impact TEXT NOT NULL DEFAULT '',
            risk_level_autocalculated VARCHAR(20),
            residual_likelihood VARCHAR(20),
            residual_severity VARCHAR(20),
            final_risk_level VARCHAR(20),
            date_of_assessment DATE,
            source VARCHAR(50) NOT NULL DEFAULT 'manual',
            taxonomy_mappings TEXT NOT NULL DEFAULT '[]',
            created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_risk_entries_register_id ON risk_entries(register_id)")

    # Add new columns to existing risk_entries table if they were missing
    # (handles the case where table was created before the VerifyWise fields were added)
    for col, definition in [
        ("risk_owner",              "VARCHAR(200)"),
        ("ai_lifecycle_phase",      "VARCHAR(50)"),
        ("impact",                  "TEXT NOT NULL DEFAULT ''"),
        ("risk_level_autocalculated","VARCHAR(20)"),
        ("residual_likelihood",     "VARCHAR(20)"),
        ("residual_severity",       "VARCHAR(20)"),
        ("final_risk_level",        "VARCHAR(20)"),
        ("date_of_assessment",      "DATE"),
    ]:
        op.execute(f"""
            DO $$ BEGIN
                ALTER TABLE risk_entries ADD COLUMN IF NOT EXISTS {col} {definition};
            END $$;
        """)

    op.execute("""
        CREATE TABLE IF NOT EXISTS misuse_scenarios (
            id VARCHAR(30) PRIMARY KEY,
            risk_id VARCHAR(30) NOT NULL REFERENCES risk_entries(id) ON DELETE CASCADE,
            actor VARCHAR(200) NOT NULL,
            description TEXT NOT NULL,
            likelihood VARCHAR(20) NOT NULL DEFAULT 'possible',
            consequence TEXT NOT NULL DEFAULT '',
            vulnerable_group VARCHAR(200),
            created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_misuse_scenarios_risk_id ON misuse_scenarios(risk_id)")

    op.execute("""
        CREATE TABLE IF NOT EXISTS mitigation_measures (
            id VARCHAR(30) PRIMARY KEY,
            risk_id VARCHAR(30) NOT NULL REFERENCES risk_entries(id) ON DELETE CASCADE,
            title VARCHAR(300) NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            hierarchy_level VARCHAR(20) NOT NULL,
            implementation_guidance TEXT NOT NULL DEFAULT '',
            status VARCHAR(20) NOT NULL DEFAULT 'planned',
            assigned_to VARCHAR(200),
            due_date TIMESTAMP WITH TIME ZONE,
            override_notes TEXT NOT NULL DEFAULT '',
            created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_mitigation_measures_risk_id ON mitigation_measures(risk_id)")

    op.execute("""
        CREATE TABLE IF NOT EXISTS reassessment_triggers (
            id VARCHAR(30) PRIMARY KEY,
            ai_system_id VARCHAR(20) NOT NULL REFERENCES ai_systems(id) ON DELETE CASCADE,
            trigger_type VARCHAR(50) NOT NULL,
            trigger_reason TEXT NOT NULL DEFAULT '',
            triggered_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            acknowledged BOOLEAN NOT NULL DEFAULT false,
            acknowledged_by VARCHAR(200),
            acknowledged_at TIMESTAMP WITH TIME ZONE,
            new_register_id VARCHAR(30) REFERENCES risk_registers(id) ON DELETE SET NULL
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_reassessment_triggers_ai_system_id ON reassessment_triggers(ai_system_id)")


def downgrade() -> None:
    op.drop_table("reassessment_triggers")
    op.drop_table("mitigation_measures")
    op.drop_table("misuse_scenarios")
    op.drop_table("risk_entries")
    op.drop_table("risk_registers")
