"""IT-09 — All backend /health endpoints return 200.

Runs first (pytest ordering by filename). A failing health check here means
the remaining suites will also fail — surfaces the root cause early.
"""

from __future__ import annotations

import httpx
import pytest

from conftest import (
    REGISTRY_URL,
    COMPLIANCE_URL,
    ALERTS_URL,
    USERS_URL,
    AUDIT_URL,
    ADMIN_URL,
    MONITORING_URL,
)

_SERVICES = [
    ("registry", REGISTRY_URL),
    ("compliance", COMPLIANCE_URL),
    ("alerts", ALERTS_URL),
    ("users", USERS_URL),
    ("audit", AUDIT_URL),
    ("admin", ADMIN_URL),
    ("monitoring", MONITORING_URL),
]


@pytest.mark.asyncio
@pytest.mark.parametrize("name,base_url", _SERVICES, ids=[s[0] for s in _SERVICES])
async def test_health(name: str, base_url: str):
    async with httpx.AsyncClient(base_url=base_url, timeout=10) as client:
        r = await client.get("/health")
    assert r.status_code == 200, f"{name} /health returned {r.status_code}: {r.text}"
    body = r.json()
    assert body.get("status") == "ok", f"{name} health body: {body}"
