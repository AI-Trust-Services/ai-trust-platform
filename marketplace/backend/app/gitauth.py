"""Optional git authentication for clone URLs.

Many internal git hosts (e.g. github.tools.sap) require authentication even for repos that
look public, because the whole instance sits behind SSO. To keep the "paste a Git URL" UX for
those internal repos, the platform can be given ONE token scoped to ONE host:

  GIT_TOKEN      — the PAT/token (read from GIT_TOKEN_FILE if set, e.g. a mounted Secret)
  GIT_TOKEN_HOST — the host it applies to (e.g. github.tools.sap)

When a clone URL's host matches GIT_TOKEN_HOST, the token is injected into the URL for the
clone only. Nothing is persisted — the git_url stored on the row stays token-free. If no token
is configured, or the host doesn't match, the URL is returned unchanged (anonymous clone).

SECURITY: the token appears in the child git process's argv/URL inside the clone container. It
is never written to the DB, the API response, or the served files.
"""
from __future__ import annotations

import os
from urllib.parse import urlsplit, urlunsplit


def _read_token() -> str:
    token_file = os.environ.get("GIT_TOKEN_FILE", "").strip()
    if token_file and os.path.exists(token_file):
        with open(token_file, encoding="utf-8") as f:
            return f.read().strip()
    return os.environ.get("GIT_TOKEN", "").strip()


def authenticated_url(git_url: str) -> str:
    """Return git_url with credentials injected iff a token is configured for its host."""
    token = _read_token()
    host = os.environ.get("GIT_TOKEN_HOST", "").strip()
    if not token or not host:
        return git_url

    parts = urlsplit(git_url)
    if parts.scheme not in ("http", "https"):
        return git_url
    # Compare host only (strip any existing userinfo/port).
    url_host = parts.hostname or ""
    if url_host.lower() != host.lower():
        return git_url

    netloc = parts.hostname or ""
    if parts.port:
        netloc = f"{netloc}:{parts.port}"
    # x-access-token is accepted by GitHub/GHE; the token is the password.
    netloc = f"x-access-token:{token}@{netloc}"
    return urlunsplit((parts.scheme, netloc, parts.path, parts.query, parts.fragment))
