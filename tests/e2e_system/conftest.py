"""E2E System test infrastructure.

Runs black-box against a live platform (kind, ai-trust-test, or ai-trust-main) through the
single entry point (oauth2-proxy on APP_URL). Unlike tests/integration, this suite:

- goes through the shell proxy on :8080 (``/api/<svc>/v1/...``), never backend ports;
- authenticates with a REAL Keycloak OIDC session cookie — no ``X-Forwarded-*`` header bypass.

Auth model: a real authorization-code login is performed once per persona per session (see
``login``). The resulting oauth2-proxy session cookie is captured and replayed into a lightweight
per-test ``httpx.AsyncClient``. Doing the real login in a session-scoped SYNC fixture via
``asyncio.run`` (then handing tests plain cookie dicts) keeps every ``AsyncClient`` on the test's
own event loop — the same pattern tests/integration uses to avoid session-scoped async-loop issues.

Personas (one Keycloak user + one role each; single-role invariant):
- admin       — APP_ADMIN_USERNAME, platform_administrator (provisions the others, cleans up).
- engineer    — e2e-engineer-<suffix>, ai_engineer.
(owner / compliance / contributor are added as their scenarios are implemented.)
"""

from __future__ import annotations

import asyncio
import os
import uuid
from html.parser import HTMLParser

import httpx
import pytest
import pytest_asyncio

APP_URL = os.getenv("APP_URL", "http://localhost:8080").rstrip("/")
KEYCLOAK_URL = os.getenv("KEYCLOAK_URL", "http://localhost:8180").rstrip("/")
ADMIN_USER = os.getenv("APP_ADMIN_USERNAME", "admin")
ADMIN_PASS = os.environ.get("APP_ADMIN_PASSWORD", "")

# Unique per session so parallel runs / reruns never collide on Keycloak usernames.
SUFFIX = os.getenv("E2E_SUFFIX") or uuid.uuid4().hex[:8]
TEMP_PASS = "E2eTempPass1!"  # temporary password set at user creation (POST /users forces temporary)
PERM_PASS = (
    "E2eSystem1!"  # permanent password set via the one-time UPDATE_PASSWORD action
)

# Session-level state.
_created_system_ids: list[str] = []
_created_user_ids: list[str] = []
_sessions: dict[str, dict[str, str]] = {}  # persona key -> captured cookie dict
_usernames: dict[str, str] = {}  # persona key -> keycloak username


# ---------------------------------------------------------------------------
# Keycloak login-form parsing (stdlib only — no lxml/bs4)
# ---------------------------------------------------------------------------


class _FormParser(HTMLParser):
    """Collects every <form> with its action and the names of its <input> fields."""

    def __init__(self) -> None:
        super().__init__()
        self.forms: list[dict] = []
        self._cur: dict | None = None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        a = dict(attrs)
        if tag == "form":
            self._cur = {"action": a.get("action"), "inputs": set()}
            self.forms.append(self._cur)
        elif tag == "input" and self._cur is not None and a.get("name"):
            self._cur["inputs"].add(a["name"])

    def handle_endtag(self, tag: str) -> None:
        if tag == "form":
            self._cur = None


def _forms(html: str) -> list[dict]:
    p = _FormParser()
    p.feed(html)
    return p.forms


def _pick_form(forms: list[dict], required: set[str]) -> dict | None:
    """First form whose inputs cover ``required`` and that has an action URL."""
    for f in forms:
        if f["action"] and required <= f["inputs"]:
            return f
    return None


async def login(
    username: str, password: str, *, new_password: str | None = None
) -> dict[str, str]:
    """Perform a real OIDC authorization-code login and return the resulting cookie dict.

    Steps: GET APP_URL/oauth2/start -> oauth2-proxy 302 -> Keycloak login page -> POST credentials ->
    (first login only) UPDATE_PASSWORD page -> POST new password -> 302 /oauth2/callback ->
    oauth2-proxy sets the session cookie -> 200 shell. ``new_password`` is required for a
    freshly-created user (temporary password); omit it for an account with a permanent password.

    We hit ``/oauth2/start`` (the canonical login initiation) rather than ``/`` so the flow works
    whether or not oauth2-proxy shows its "Sign in with …" provider-button interstitial page.
    """
    async with httpx.AsyncClient(follow_redirects=True, timeout=30) as c:
        r = await c.get(f"{APP_URL}/oauth2/start", params={"rd": "/"})
        form = _pick_form(_forms(r.text), {"username", "password"})
        assert form, (
            f"No Keycloak login form at {r.url} for '{username}'. "
            f"Page start:\n{r.text[:500]}"
        )
        r = await c.post(
            form["action"], data={"username": username, "password": password}
        )

        update = _pick_form(_forms(r.text), {"password-new", "password-confirm"})
        if update:
            assert new_password, (
                f"Keycloak requires a password update for '{username}' "
                "but new_password was not provided"
            )
            r = await c.post(
                update["action"],
                data={"password-new": new_password, "password-confirm": new_password},
            )

        assert r.status_code == 200, (
            f"Login for '{username}' did not land on 200 (got {r.status_code}).\n"
            f"Body start:\n{r.text[:400]}"
        )
        cookies = {ck.name: ck.value for ck in c.cookies.jar}
        assert cookies, f"No session cookie captured after login for '{username}'"
        return cookies


# ---------------------------------------------------------------------------
# Session-scoped provisioning + cleanup (sync fixture, real login via asyncio.run)
# ---------------------------------------------------------------------------


@pytest.fixture(scope="session", autouse=True)
def _provision_personas():
    assert ADMIN_PASS, (
        "APP_ADMIN_PASSWORD must be set (source .env locally, or the CI secret). "
        "The E2E system suite logs the admin in via real OIDC — there is no header bypass."
    )
    asyncio.run(_setup())
    yield
    asyncio.run(_cleanup())


async def _setup() -> None:
    admin_cookies = await login(ADMIN_USER, ADMIN_PASS)
    _sessions["admin"] = admin_cookies
    _usernames["admin"] = ADMIN_USER

    await _provision_user(
        admin_cookies, "engineer", f"e2e-engineer-{SUFFIX}", "ai_engineer"
    )
    await _provision_user(
        admin_cookies, "owner", f"e2e-owner-{SUFFIX}", "business_owner"
    )
    await _provision_user(
        admin_cookies, "compliance", f"e2e-compliance-{SUFFIX}", "ai_compliance_officer"
    )
    await _provision_user(
        admin_cookies, "contributor", f"e2e-contributor-{SUFFIX}", "ai_engineer"
    )


async def _provision_user(
    admin_cookies: dict[str, str], key: str, username: str, role: str
) -> None:
    """Create a Keycloak user (idempotent) and assign one role, then capture its OIDC session."""
    async with httpx.AsyncClient(
        base_url=APP_URL, cookies=admin_cookies, timeout=30
    ) as a:
        r = await a.post(
            "/api/users/v1/users",
            json={
                "username": username,
                "email": f"{username}@e2e.example.com",
                "firstName": "E2E",
                "lastName": "Test",
                "temporaryPassword": TEMP_PASS,
            },
        )
        assert r.status_code in (
            201,
            409,
        ), f"create user {username}: {r.status_code} {r.text}"

        s = await a.get("/api/users/v1/users", params={"search": username})
        assert s.status_code == 200, s.text
        users_list = s.json().get("users", s.json())
        uid = next((u["id"] for u in users_list if u.get("username") == username), None)
        assert uid, f"user '{username}' not found after creation"

        rr = await a.post(f"/api/users/v1/users/{uid}/roles/{role}")
        assert rr.status_code in (
            200,
            201,
            204,
        ), f"assign role {role}: {rr.status_code} {rr.text}"

    _created_user_ids.append(uid)
    _usernames[key] = username
    _sessions[key] = await login(username, TEMP_PASS, new_password=PERM_PASS)


async def _cleanup() -> None:
    # Systems require SYSTEMS_APPROVE or SYSTEMS_WRITE (draft-only).
    # platform_administrator has only IAM_MANAGE — use compliance (SYSTEMS_APPROVE) instead.
    sys_cookies = _sessions.get("compliance") or _sessions.get("engineer")
    admin_cookies = _sessions.get("admin")
    if not admin_cookies:
        return
    async with httpx.AsyncClient(
        base_url=APP_URL, cookies=sys_cookies or admin_cookies, timeout=30
    ) as a:
        for sid in _created_system_ids:
            r = await a.delete(f"/api/registry/v1/systems/{sid}")
            if r.status_code not in (200, 204, 404):
                print(f"Warning: cleanup of system {sid} -> {r.status_code}: {r.text}")
    async with httpx.AsyncClient(
        base_url=APP_URL, cookies=admin_cookies, timeout=30
    ) as a:
        for uid in _created_user_ids:
            r = await a.delete(f"/api/users/v1/users/{uid}")
            if r.status_code not in (200, 204, 404):
                print(f"Warning: cleanup of user {uid} -> {r.status_code}: {r.text}")
    _created_system_ids.clear()
    _created_user_ids.clear()


# ---------------------------------------------------------------------------
# Domain helpers (re-exported for test modules)
# ---------------------------------------------------------------------------

# Imported here so test files can do `from conftest import BUSINESS_ANSWERS, register_system`
# rather than knowing about the helpers module.
from helpers import AI_TECHNICAL_ANSWERS, BUSINESS_ANSWERS, VALID_TIERS
from helpers import register_manual_system as _reg


async def register_system(
    client: httpx.AsyncClient,
    *,
    flags: dict | None = None,
    business_answers: dict | None = None,
    name: str | None = None,
    mode: str = "manual_questionnaire",
) -> dict:
    """Convenience wrapper — forwards session state to helpers.register_manual_system."""
    return await _reg(
        client,
        APP_URL,
        _created_system_ids,
        flags=flags,
        business_answers=business_answers,
        name=name or f"E2E System {SUFFIX}",
        mode=mode,
    )


# ---------------------------------------------------------------------------
# Per-test fixtures
# ---------------------------------------------------------------------------


def _authed_client(key: str) -> httpx.AsyncClient:
    client = httpx.AsyncClient(
        base_url=APP_URL,
        cookies=_sessions[key],
        follow_redirects=True,
        timeout=30,
    )
    # The persona's Keycloak username — workflow payloads reference assignees by username.
    client.e2e_username = _usernames[key]
    return client


@pytest.fixture
def app_url() -> str:
    return APP_URL


@pytest_asyncio.fixture
async def admin_client():
    c = _authed_client("admin")
    yield c
    await c.aclose()


@pytest_asyncio.fixture
async def engineer():
    c = _authed_client("engineer")
    yield c
    await c.aclose()


@pytest_asyncio.fixture
async def owner():
    c = _authed_client("owner")
    yield c
    await c.aclose()


@pytest_asyncio.fixture
async def compliance():
    c = _authed_client("compliance")
    yield c
    await c.aclose()


@pytest_asyncio.fixture
async def contributor():
    c = _authed_client("contributor")
    yield c
    await c.aclose()


# ---------------------------------------------------------------------------
# Workflow helper (importable from test modules)
# ---------------------------------------------------------------------------


async def set_all_questionnaire_answers(
    client: httpx.AsyncClient,
    system_id: str,
) -> None:
    """PATCH business questionnaire answers on a draft system.

    intake.py hardcodes registration_mode='ai' and does not store questionnaire_answers,
    so we must PATCH after registration for any test that drives through to approval.
    Only the business section can be PATCHed in draft state; the technical section requires
    technical_pending state — pass with_technical_answers=True to drive_to_pending_review
    to have it PATCH technical answers before submit-technical.
    """
    r = await client.patch(
        f"/api/registry/v1/systems/{system_id}/questionnaire",
        json={"section": "business", "answers": BUSINESS_ANSWERS},
    )
    assert r.status_code == 200, (
        f"PATCH business answers failed: {r.status_code} {r.text[:300]}"
    )


async def drive_to_pending_review(
    system_id: str,
    owner_client: httpx.AsyncClient,
    engineer_client: httpx.AsyncClient,
    compliance_username: str,
    *,
    with_technical_answers: bool = False,
) -> None:
    """Assign + submit-business + submit-technical, asserting each transition via GET.

    Pass with_technical_answers=True for tests that need approval (the approve gate checks
    REQUIRED_AI_TECHNICAL keys). Technical PATCH is done in technical_pending state before
    submit-technical, using engineer_client (the technical section owner).
    """
    base = f"/api/registry/v1/systems/{system_id}/workflow"

    r = await owner_client.post(
        f"{base}/assign",
        json={
            "business_assignee_username": owner_client.e2e_username,
            "technical_assignee_username": engineer_client.e2e_username,
            "compliance_officer_username": compliance_username,
        },
    )
    assert r.status_code == 200, f"assign failed: {r.status_code} {r.text[:300]}"
    sys = (await owner_client.get(f"/api/registry/v1/systems/{system_id}")).json()
    assert sys["workflow_status"] == "business_pending", sys["workflow_status"]

    r = await owner_client.post(f"{base}/submit-business", json={})
    assert r.status_code == 200, (
        f"submit-business failed: {r.status_code} {r.text[:300]}"
    )
    sys = (await owner_client.get(f"/api/registry/v1/systems/{system_id}")).json()
    assert sys["workflow_status"] == "technical_pending", sys["workflow_status"]

    if with_technical_answers:
        r = await engineer_client.patch(
            f"/api/registry/v1/systems/{system_id}/questionnaire",
            json={"section": "technical", "answers": AI_TECHNICAL_ANSWERS},
        )
        assert r.status_code == 200, (
            f"PATCH technical answers failed: {r.status_code} {r.text[:300]}"
        )

    r = await engineer_client.post(f"{base}/submit-technical", json={})
    assert r.status_code == 200, (
        f"submit-technical failed: {r.status_code} {r.text[:300]}"
    )
    sys = (await owner_client.get(f"/api/registry/v1/systems/{system_id}")).json()
    assert sys["workflow_status"] == "pending_review", sys["workflow_status"]
