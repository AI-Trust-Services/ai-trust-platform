"""FORCE row-level security so RLS holds even against the table owner (defense-in-depth)

Revision ID: 0011
Revises: 0010
Create Date: 2026-08-13

SEC-M1 hardening (re-audit finding). Migrations 0009/0010 used ENABLE ROW LEVEL SECURITY,
which a SUPERUSER or a BYPASSRLS role (and the table OWNER) bypasses. Runtime backends are
supposed to connect as the non-superuser NOBYPASSRLS role `ai_trust_app`, for which ENABLE is
sufficient. But if a deployment ever (mis)connects the app as the owner/superuser, ENABLE-only
RLS silently does nothing. FORCE ROW LEVEL SECURITY makes the policy apply to the table owner
too — so the only way to bypass is an explicit superuser / BYPASSRLS role.

Seeders/migrations run as the owner which is ALSO a superuser (postgres) → superusers still
bypass even FORCE, so catalog seeding (frameworks/model_cards/alert_rules with tenant_id NULL)
keeps working. This migration therefore does not break seeding; it only closes the "app
accidentally connects as a non-superuser owner" gap and documents the intent.

REQUIREMENT (documented in docs/adr/adr-001-tenancy.md): runtime DATABASE_URL MUST use the
non-superuser `ai_trust_app` role (NOBYPASSRLS). FORCE is defense-in-depth, not a substitute.

Idempotent.
"""
from alembic import op

revision = "0011"
down_revision = "0010"
branch_labels = None
depends_on = None

TENANT_TABLES = [
    "ai_systems", "assessments", "obligations", "controls", "evidence",
    "evidence_versions", "evidence_controls", "evidence_obligations",
    "control_obligations", "alert_rules", "service_model_baselines",
]


def upgrade() -> None:
    for t in TENANT_TABLES:
        op.execute(f"ALTER TABLE {t} FORCE ROW LEVEL SECURITY")


def downgrade() -> None:
    for t in TENANT_TABLES:
        op.execute(f"ALTER TABLE {t} NO FORCE ROW LEVEL SECURITY")
