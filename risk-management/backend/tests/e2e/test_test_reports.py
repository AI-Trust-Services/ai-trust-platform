"""E2E tests for /v1/risks/{risk_id}/test-reports endpoints."""
from __future__ import annotations

from tests.e2e.conftest import approve_register, create_register, create_risk, create_system


async def test_create_test_report_after_register_approved_is_rejected(client):
    """Mirrors test_add_mitigation_after_register_approved_is_rejected: a
    risk-scoped create can't be redirected to the cloned register's copy of
    the risk, so it must fail loudly instead of silently orphaning data.
    """
    sys_row = await create_system(tier="minimal")
    reg = await create_register(client, system_id=sys_row["id"])
    risk = await create_risk(client, register_id=reg["id"], residual_status="none")
    await approve_register(client, reg["id"])

    r = await client.post(
        f"/v1/risks/{risk['id']}/test-reports",
        json={"title": "Too late"},
    )
    assert r.status_code == 409, r.text
