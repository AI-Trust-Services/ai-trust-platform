"""Add tenant_id + row-level security (multi-tenancy foundation)

Revision ID: 0009
Revises: 0008
Create Date: 2026-08-13

Idempotent by design: the deployed MT database already had these columns + RLS
policies applied out-of-band (before this migration existed). This migration
reconstructs that state in the repo so `git == prod`, AND adds the one thing prod
was missing: a server-side DEFAULT that stamps `tenant_id` on INSERT from the
current transaction's `app.current_tenant` setting. Every statement is guarded
(IF NOT EXISTS / DROP ... IF EXISTS) so running it against the already-provisioned
database is safe and only fills in the missing DEFAULT.

Tenancy model (see libs/tenancy):
  - runtime backends connect as the non-superuser role `ai_trust_app` (NOBYPASSRLS),
    so the policy is enforced; migrations/seeders run as the owner (postgres), which
    bypasses RLS (relforcerowsecurity = false) and writes shared (tenant_id IS NULL) rows.
  - the policy USING/WITH CHECK is `tenant_id = current_setting('app.current_tenant', true)
    OR tenant_id IS NULL`: a tenant sees its own rows + shared/catalog (NULL) rows.
  - `libs/tenancy` sets `app.current_tenant` per request (SELECT set_config(...,true));
    combined with the DEFAULT below, INSERTs land with the right tenant_id automatically.
"""
from alembic import op

revision = "0009"
down_revision = "0008"
branch_labels = None
depends_on = None

# The 11 tenant-scoped business tables (verified against the deployed DB).
# NOT scoped (global/catalog): frameworks, model_cards, custom_roles, alembic_version.
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

_POLICY = (
    "(tenant_id::text = current_setting('app.current_tenant', true) "
    "OR tenant_id IS NULL)"
)


def upgrade() -> None:
    for t in TENANT_TABLES:
        # 1. tenant_id column (nullable — NULL = shared/catalog row visible to all tenants).
        op.execute(f"ALTER TABLE {t} ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(64)")
        # 2. index for tenant-scoped scans.
        op.execute(f"CREATE INDEX IF NOT EXISTS ix_{t}_tenant_id ON {t} (tenant_id)")
        # 3. server-side stamp on INSERT (the piece prod was missing): default the column to
        #    the current transaction's tenant. current_setting(..., true) returns NULL when unset
        #    (single-tenant / owner writes), so those rows become shared — backward compatible.
        op.execute(
            f"ALTER TABLE {t} ALTER COLUMN tenant_id "
            f"SET DEFAULT current_setting('app.current_tenant', true)"
        )
        # 4. enable RLS (not FORCE — owner/superuser bypasses for migrations & seeders).
        op.execute(f"ALTER TABLE {t} ENABLE ROW LEVEL SECURITY")
        # 5. the isolation policy (idempotent: drop-if-exists then create).
        op.execute(f"DROP POLICY IF EXISTS tenant_isolation ON {t}")
        op.execute(
            f"CREATE POLICY tenant_isolation ON {t} "
            f"USING {_POLICY} WITH CHECK {_POLICY}"
        )


def downgrade() -> None:
    for t in TENANT_TABLES:
        op.execute(f"DROP POLICY IF EXISTS tenant_isolation ON {t}")
        op.execute(f"ALTER TABLE {t} DISABLE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {t} ALTER COLUMN tenant_id DROP DEFAULT")
        op.execute(f"DROP INDEX IF EXISTS ix_{t}_tenant_id")
        op.execute(f"ALTER TABLE {t} DROP COLUMN IF EXISTS tenant_id")
