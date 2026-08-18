"""Tenant isolation integration test — schema-per-tenant + per-tenant role (RLS removed 2026-08).

Isolation is now enforced by TWO hard Postgres walls (no RLS):
  1. schema-per-tenant: each tenant's tables live in schema `tenant_<org>`, reached via search_path;
  2. per-tenant role `t_<org>` with USAGE on ONLY its own schema, and the shared login role holds it
     `WITH INHERIT FALSE` (must SET ROLE explicitly) and has NO direct grant on any tenant schema.
So a request scoped to tenant A physically cannot read tenant B's schema — Postgres denies with
`permission denied for schema tenant_<B>` (a hard privilege deny, not an RLS row-filter to 0 rows).

This test provisions two throwaway tenant schemas + roles the way the operator's tenant-stores Job
does, then proves the cross-tenant access is DENIED at the privilege level with RLS absent.

Requires a live/test Postgres connected as the OWNER (to create schemas/roles). Skipped otherwise.
"""
from __future__ import annotations

import os
import uuid

import pytest

pytestmark = pytest.mark.asyncio

DB = os.environ.get("DATABASE_URL", "")
skip = pytest.mark.skipif(not DB, reason="DATABASE_URL not set (needs a test Postgres)")


@skip
async def test_schema_and_role_isolation_no_rls():
    from sqlalchemy import text
    from sqlalchemy.ext.asyncio import create_async_engine

    engine = create_async_engine(DB)
    suf = uuid.uuid4().hex[:8]
    a, b = f"tA_{suf}", f"tB_{suf}"          # safe unquoted identifiers
    schA, schB = f"tenant_{a}", f"tenant_{b}"
    roleA = f"t_{a}"
    app = "ai_trust_app"
    try:
        # --- provision two tenant schemas + roles the way the operator does (as owner) ---
        async with engine.begin() as conn:
            for sch, role in ((schA, roleA), (schB, f"t_{b}")):
                await conn.execute(text(f'CREATE SCHEMA IF NOT EXISTS "{sch}"'))
                await conn.execute(text(f'CREATE TABLE IF NOT EXISTS "{sch}".ai_systems '
                                        f'(id text primary key, name text)'))
                await conn.execute(text(
                    f"DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='{role}') "
                    f"THEN CREATE ROLE \"{role}\" NOLOGIN; END IF; END $$"))
                await conn.execute(text(f'GRANT USAGE ON SCHEMA "{sch}" TO "{role}"'))
                await conn.execute(text(f'GRANT SELECT,INSERT ON ALL TABLES IN SCHEMA "{sch}" TO "{role}"'))
                # shared login role may SET ROLE into it, but inherits nothing + has NO direct schema grant
                await conn.execute(text(f'GRANT "{role}" TO {app} WITH INHERIT FALSE'))
                await conn.execute(text(f'REVOKE ALL ON SCHEMA "{sch}" FROM {app}'))
            await conn.execute(text(f'INSERT INTO "{schB}".ai_systems VALUES (:i,:n)'),
                               {"i": "SYS-B", "n": "b-secret"})

        # --- as the shared app role, SET ROLE t_A: reading tenant B's schema is DENIED ---
        async with engine.connect() as conn:
            await conn.execute(text(f"SET ROLE {app}"))
            await conn.execute(text(f'SET ROLE "{roleA}"'))
            with pytest.raises(Exception) as ei:
                await conn.execute(text(f'SELECT id FROM "{schB}".ai_systems'))
            assert "permission denied for schema" in str(ei.value).lower(), \
                f"expected schema-level permission denial, got: {ei.value}"

        # --- and RLS is indeed OFF on the tenant tables (schema+role is the sole wall) ---
        async with engine.connect() as conn:
            row = (await conn.execute(text(
                "SELECT relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace "
                "WHERE c.relname='ai_systems' AND n.nspname=:s"), {"s": schB})).first()
            # test tables created above have RLS off by default; the real migration 0012 also disables it.
            assert row is None or row[0] is False
    finally:
        async with engine.begin() as conn:
            await conn.execute(text("RESET ROLE"))
            for sch in (schA, schB):
                await conn.execute(text(f'DROP SCHEMA IF EXISTS "{sch}" CASCADE'))
            for role in (roleA, f"t_{b}"):
                await conn.execute(text(f'REVOKE "{role}" FROM {app}'))
                await conn.execute(text(f'DROP ROLE IF EXISTS "{role}"'))
        await engine.dispose()
