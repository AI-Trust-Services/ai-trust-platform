"""Tighten RLS: tenants may READ shared (tenant_id IS NULL) rows but may only WRITE their own

Revision ID: 0010
Revises: 0009
Create Date: 2026-08-13

SEC-M1: migration 0009's policy used the SAME expression for USING and WITH CHECK —
`(tenant_id = current_setting('app.current_tenant', true) OR tenant_id IS NULL)`. The
`OR tenant_id IS NULL` in WITH CHECK let a tenant INSERT/UPDATE a row with tenant_id NULL,
i.e. create a GLOBALLY-SHARED row visible to every other tenant. This migration splits the
two:
  - USING  (read/visibility): unchanged — a tenant sees its own rows + shared/catalog (NULL) rows.
  - WITH CHECK (write): tightened to `tenant_id = current_setting('app.current_tenant', true)`
    — a tenant can only write rows stamped with ITS OWN tenant. The server-side DEFAULT from
    0009 already stamps tenant_id on INSERT, so well-behaved inserts are unaffected; an attempt
    to write NULL or another tenant's id is now rejected.

Note: seeders/migrations run as the table OWNER (postgres), which BYPASSES RLS, so seeding
shared catalog rows (frameworks, model_cards, alert_rules with tenant_id NULL) still works.

Idempotent: DROP POLICY IF EXISTS then CREATE, so it is safe to re-run.
"""
from alembic import op

revision = "0010"
down_revision = "0009"
branch_labels = None
depends_on = None

# Same 11 tenant-scoped tables as 0009.
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

_USING = (
    "(tenant_id::text = current_setting('app.current_tenant', true) "
    "OR tenant_id IS NULL)"
)
# write-own only: no NULL escape hatch
_CHECK = "(tenant_id::text = current_setting('app.current_tenant', true))"

# revert (0009 behaviour): USING == WITH CHECK, both allow NULL
_CHECK_0009 = _USING


def upgrade() -> None:
    for t in TENANT_TABLES:
        op.execute(f"DROP POLICY IF EXISTS tenant_isolation ON {t}")
        op.execute(
            f"CREATE POLICY tenant_isolation ON {t} "
            f"USING {_USING} WITH CHECK {_CHECK}"
        )


def downgrade() -> None:
    for t in TENANT_TABLES:
        op.execute(f"DROP POLICY IF EXISTS tenant_isolation ON {t}")
        op.execute(
            f"CREATE POLICY tenant_isolation ON {t} "
            f"USING {_USING} WITH CHECK {_CHECK_0009}"
        )
