"""Shared constants and domain helpers for the E2E system test suite.

Kept in a separate module so both conftest.py and test modules can import cleanly.
The directory must NOT have __init__.py — pytest then adds rootdir to sys.path,
making both this module and conftest importable by name (same pattern as tests/integration/).
"""

from __future__ import annotations

import httpx

# Minimum business questionnaire answers that satisfy the approval gate.
# Keys map to REQUIRED_BUSINESS in ai-system-registry/backend/app/questionnaire_required.py.
# All placed in questionnaire_answers; "department" / "use_case" also have dedicated system
# columns but the approval check accepts answers from either location.
BUSINESS_ANSWERS: dict[str, str] = {
    "submission_type": "new",
    "use_case_owner": "E2E Owner",
    "use_case_type": "internal",
    "department": "Engineering",
    "technologies": "ML",
    "use_case_status": "development",
    "use_case": "E2E test use case description",
    "planned_modifications": "none",
    "exception_category": "none",
    "sector_legislation": "none",
}

# Valid EU AI Act tiers — for structural assertions in AI-mode tests.
VALID_TIERS = frozenset(
    {"prohibited", "gpai-systemic", "gpai-standard", "high", "limited", "minimal", "pending"}
)


async def register_manual_system(
    client: httpx.AsyncClient,
    app_url: str,
    created_system_ids: list[str],
    *,
    flags: dict | None = None,
    business_answers: dict | None = None,
    name: str | None = None,
    mode: str = "manual_questionnaire",
    suffix: str = "",
) -> dict:
    """Register an AI system via POST /api/registry/v1/intake and track its ID for cleanup.

    Args:
        client: authenticated httpx client (has base_url set to app_url)
        app_url: platform entry-point URL (unused when client already has base_url, kept for clarity)
        created_system_ids: session-level list to append the new system ID to for teardown
        flags: risk-classification flags merged into the intake payload (e.g. is_critical_infrastructure)
        business_answers: questionnaire_answers dict (see BUSINESS_ANSWERS for required keys)
        name: system name; defaults to "E2E System <suffix>"
        mode: registration_mode — "manual_questionnaire" (default), "ai", or "full_manual"
        suffix: unique suffix for the name; if empty, caller should ensure uniqueness
    """
    payload: dict = {
        "name": name or f"E2E System {suffix}",
        "description": "E2E automated test system",
        "registration_mode": mode,
    }
    if flags:
        payload.update(flags)
    if business_answers:
        payload["questionnaire_answers"] = business_answers
    r = await client.post("/api/registry/v1/intake", json=payload)
    assert r.status_code == 201, f"intake failed: {r.status_code} {r.text[:400]}"
    body = r.json()
    system = body.get("system", body)
    created_system_ids.append(system["id"])
    return system
