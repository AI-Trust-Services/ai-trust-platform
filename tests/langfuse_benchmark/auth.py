"""OIDC login against a deployed AI Trust namespace through oauth2-proxy.

Lifted from ``tests/e2e_system/conftest.py`` (the E2E system suite) so the Langfuse
benchmark can authenticate the same way the e2e tests do: a real Keycloak
authorization-code login, no ``X-Forwarded-*`` header bypass. Stdlib-only HTML form
parsing (no bs4/lxml) keeps the dependency surface tiny.

``login()`` returns the oauth2-proxy session cookie dict, which the caller replays on
an ``httpx.Client`` for subsequent API calls.
"""

from __future__ import annotations

from html.parser import HTMLParser

import httpx


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


def login(
    app_url: str,
    username: str,
    password: str,
    *,
    new_password: str | None = None,
    timeout: float = 30.0,
) -> dict[str, str]:
    """Perform a real OIDC authorization-code login and return the session cookie dict.

    Steps: GET app_url/oauth2/start -> oauth2-proxy 302 -> Keycloak login page -> POST
    credentials -> (first login only) UPDATE_PASSWORD page -> POST new password -> 302
    /oauth2/callback -> oauth2-proxy sets the session cookie -> 200 shell.

    ``new_password`` is only needed for a freshly-created user carrying a temporary
    password; omit it for an account with a permanent password (the usual case for the
    bootstrap admin the benchmark runs as).

    We hit ``/oauth2/start`` (the canonical login initiation) rather than ``/`` so the
    flow works whether or not oauth2-proxy shows its provider-button interstitial page.
    """
    app_url = app_url.rstrip("/")
    with httpx.Client(follow_redirects=True, timeout=timeout) as c:
        r = c.get(f"{app_url}/oauth2/start", params={"rd": "/"})
        form = _pick_form(_forms(r.text), {"username", "password"})
        if not form:
            raise RuntimeError(
                f"No Keycloak login form at {r.url} for '{username}'. "
                f"Page start:\n{r.text[:500]}"
            )
        r = c.post(form["action"], data={"username": username, "password": password})

        update = _pick_form(_forms(r.text), {"password-new", "password-confirm"})
        if update:
            if not new_password:
                raise RuntimeError(
                    f"Keycloak requires a password update for '{username}' "
                    "but new_password was not provided"
                )
            r = c.post(
                update["action"],
                data={"password-new": new_password, "password-confirm": new_password},
            )

        if r.status_code != 200:
            raise RuntimeError(
                f"Login for '{username}' did not land on 200 (got {r.status_code}).\n"
                f"Body start:\n{r.text[:400]}"
            )
        cookies = {ck.name: ck.value or "" for ck in c.cookies.jar}
        if not cookies:
            raise RuntimeError(
                f"No session cookie captured after login for '{username}'"
            )
        return cookies
