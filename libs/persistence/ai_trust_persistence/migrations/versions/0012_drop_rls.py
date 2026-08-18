"""Drop Row-Level Security — schema-per-tenant + per-tenant role is now the sole isolation

Revision ID: 0012
Revises: 0011
Create Date: 2026-08-17

DECISION CHANGE (supersedes 0009/0010/0011 + ADR-001): RLS was defense-in-depth on top of the
real isolation walls — schema-per-tenant (`search_path = tenant_<org>`) + a per-tenant Postgres
role `t_<org>` whose USAGE is scoped to ONLY that schema (so Postgres denies cross-tenant access
at the PRIVILEGE level, a hard deny independent of RLS). The user asked to remove the RLS backup
and rely on one-tenant-per-schema. This migration disables + drops the RLS layer while KEEPING the
`tenant_id` column + index (harmless; still stamp-able; dropping it would be a larger, riskier
change and is out of scope — the ask was to remove RLS, not the column).

`libs/tenancy/session.py` no longer sets `app.current_tenant` (the policy activator), so even if a
policy lingered it would be inert; this migration removes the policies for real.

Runs against whatever schema the connection's search_path targets. In the schema-per-tenant deploy
the rollout runs this per `tenant_<org>` schema (each has its own alembic_version); locally/single
it runs once against public. Idempotent (IF EXISTS / NO FORCE + DISABLE are safe to re-run).

Fully reversible: downgrade() restores 0009+0010 policy semantics + 0011 FORCE + the INSERT default.
"""
from alembic import op

revision = "0012"
down_revision = "0011"
branch_labels = None
depends_on = None

# Same 11 tenant-scoped tables as 0009/0010/0011.
TENANT_TABLES = [
    "ai_systems",
    "assessments",
    "obligations",
    "controls",
    "evidence",
    "evidence_versions",
    "evidence_controls",
    "evidence_obligations",
    "control_obligations",
    "alert_rules",
    "service_model_baselines",
]

# --- for downgrade: the 0009/0010/0011 policy expressions (read own+catalog; write own only) ---
_USING = (
    "(tenant_id::text = current_setting('app.current_tenant', true) "
    "OR tenant_id IS NULL)"
)
_CHECK = "(tenant_id::text = current_setting('app.current_tenant', true))"


def upgrade() -> None:
    for t in TENANT_TABLES:
        # order: drop the FORCE (0011) → the policy (0009/0010) → disable RLS → drop the INSERT default.
        # `to_regclass` guard so this is safe even if a table is absent in a given schema.
        op.execute(
            f"DO $$ BEGIN IF to_regclass('{t}') IS NOT NULL THEN "
            f"EXECUTE 'ALTER TABLE {t} NO FORCE ROW LEVEL SECURITY'; "
            f"EXECUTE 'DROP POLICY IF EXISTS tenant_isolation ON {t}'; "
            f"EXECUTE 'ALTER TABLE {t} DISABLE ROW LEVEL SECURITY'; "
            f"EXECUTE 'ALTER TABLE {t} ALTER COLUMN tenant_id DROP DEFAULT'; "
            f"END IF; END $$;"
        )
    # KEEP the tenant_id column + ix_<t>_tenant_id index (intentionally not dropped).


def downgrade() -> None:
    # Restore RLS defense-in-depth exactly as 0009 (default) + 0010 (write-own policy) + 0011 (FORCE).
    for t in TENANT_TABLES:
        op.execute(
            f"DO $$ BEGIN IF to_regclass('{t}') IS NOT NULL THEN "
            f"EXECUTE 'ALTER TABLE {t} ALTER COLUMN tenant_id "
            f"SET DEFAULT current_setting(''app.current_tenant'', true)'; "
            f"EXECUTE 'ALTER TABLE {t} ENABLE ROW LEVEL SECURITY'; "
            f"EXECUTE 'DROP POLICY IF EXISTS tenant_isolation ON {t}'; "
            f"EXECUTE 'CREATE POLICY tenant_isolation ON {t} "
            f"USING {_USING} WITH CHECK {_CHECK}'; "
            f"EXECUTE 'ALTER TABLE {t} FORCE ROW LEVEL SECURITY'; "
            f"END IF; END $$;"
        )
