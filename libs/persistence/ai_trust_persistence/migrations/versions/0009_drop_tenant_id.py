"""Drop the legacy tenant_id column; isolation is schema-per-tenant

Revision ID: 0009
Revises: 0008
Create Date: 2026-08-19

Tenant isolation is enforced physically, one tenant per Postgres schema
(``search_path = tenant_<org>``) plus a per-tenant role ``t_<org>`` whose USAGE
is scoped to only that schema — Postgres denies cross-tenant access at the
privilege level, a hard deny. The old per-row ``tenant_id`` discriminator column
was redundant on top of that wall, so this migration removes it (and the index
on it) from every business table.

Every statement is guarded with IF EXISTS / to_regclass / catalog checks, so this
migration is a no-op on a fresh database (where the column was never created) and
effective on an existing one (where the column was applied out-of-band). It also
reverts ``service_model_baselines`` from a composite ``(tenant_id, service_name)``
primary key back to the original single-column ``(service_name)`` PK, guarded so it
only runs where that composite PK actually exists.

Forward-only cleanup: downgrade() is intentionally a no-op.
"""
from alembic import op

revision = "0009"
down_revision = "0008"
branch_labels = None
depends_on = None

# The 11 tables that carried the legacy tenant_id column.
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


def upgrade() -> None:
    # 1. Revert service_model_baselines PK from (tenant_id, service_name) -> (service_name),
    #    but only if the composite PK is actually in place (guarded: no-op otherwise).
    op.execute(
        "DO $$ "
        "DECLARE pk_name text; pk_conrelid oid; "
        "BEGIN "
        "  IF to_regclass('service_model_baselines') IS NULL THEN RETURN; END IF; "
        "  SELECT c.conname, c.conrelid INTO pk_name, pk_conrelid "
        "    FROM pg_constraint c "
        "    JOIN pg_class t ON t.oid = c.conrelid "
        "   WHERE t.relname = 'service_model_baselines' AND c.contype = 'p' "
        "     AND c.conrelid = 'service_model_baselines'::regclass; "
        "  IF pk_name IS NOT NULL AND EXISTS ( "
        "        SELECT 1 FROM pg_attribute a "
        "         WHERE a.attrelid = pk_conrelid "
        "           AND a.attname = 'tenant_id' "
        "           AND a.attnum = ANY (( "
        "                 SELECT conkey FROM pg_constraint "
        "                  WHERE conname = pk_name AND conrelid = pk_conrelid )::int2[]) "
        "     ) THEN "
        "    EXECUTE 'ALTER TABLE service_model_baselines DROP CONSTRAINT ' || quote_ident(pk_name); "
        "    EXECUTE 'ALTER TABLE service_model_baselines ADD PRIMARY KEY (service_name)'; "
        "  END IF; "
        "END $$;"
    )

    # 2. For each tenant table: drop the RLS policy + disable/no-force RLS (if present),
    #    drop the tenant_id index, and drop the tenant_id column. All guarded so this is a
    #    no-op on a fresh DB and effective on an existing one.
    for t in TENANT_TABLES:
        op.execute(
            f"DO $$ BEGIN IF to_regclass('{t}') IS NOT NULL THEN "
            f"  EXECUTE 'DROP POLICY IF EXISTS tenant_isolation ON {t}'; "
            f"  IF EXISTS (SELECT 1 FROM pg_class WHERE oid = '{t}'::regclass AND relrowsecurity) THEN "
            f"    EXECUTE 'ALTER TABLE {t} NO FORCE ROW LEVEL SECURITY'; "
            f"    EXECUTE 'ALTER TABLE {t} DISABLE ROW LEVEL SECURITY'; "
            f"  END IF; "
            f"  EXECUTE 'DROP INDEX IF EXISTS ix_{t}_tenant_id'; "
            f"  EXECUTE 'ALTER TABLE {t} DROP COLUMN IF EXISTS tenant_id'; "
            f"END IF; END $$;"
        )


def downgrade() -> None:
    # Forward-only cleanup: the legacy tenant_id column / RLS layer is not recreated.
    pass
