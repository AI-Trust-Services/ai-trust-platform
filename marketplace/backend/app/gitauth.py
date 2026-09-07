"""Optional git authentication for clone URLs.

Many internal git hosts (e.g. github.tools.sap) require authentication even for repos that
look public, because the whole instance sits behind SSO. To keep the "paste a Git URL" UX for
those internal repos, the platform can be given ONE token scoped to ONE host:

  GIT_TOKEN      — the PAT/token (read from GIT_TOKEN_FILE if set, e.g. a mounted Secret)
  GIT_TOKEN_HOST — the host it applies to (e.g. github.tools.sap)

When a clone URL's host matches GIT_TOKEN_HOST, the token is used to authenticate the clone.

SECURITY: the token is handed to git out-of-band — via GIT_ASKPASS + a GIT_PASSWORD env var
(k8s: sourced from a per-app Secret; compose: the clone container's `environment=`), so the
clone URL stays token-free and the token never appears in a container's argv/command, the
Deployment/Job spec, the DB, the API response, or the served files. `credentials_for` is the
supported entry point; `authenticated_url` (URL-embedded token) is deprecated — do NOT use it in
a deploy path, since the URL lands in the object spec where anyone with `get pod` RBAC can read it.
"""
from __future__ import annotations

import os
from urllib.parse import urlsplit, urlunsplit

# Git-clone command prelude that wires GIT_ASKPASS to a throwaway script echoing $GIT_PASSWORD, so
# git reads the credential from the environment rather than the URL. Prepend to any clone shell
# command run in a container that has GIT_USERNAME/GIT_PASSWORD in its environment; harmless (a no-op
# askpass returning an empty password) when they're unset, so anonymous clones still work.
ASKPASS_PRELUDE = (
    "printf '#!/bin/sh\\necho \"$GIT_PASSWORD\"\\n' > /tmp/askpass.sh; "
    "chmod +x /tmp/askpass.sh; export GIT_ASKPASS=/tmp/askpass.sh GIT_TERMINAL_PROMPT=0; "
)


def _read_token() -> str:
    token_file = os.environ.get("GIT_TOKEN_FILE", "").strip()
    if token_file and os.path.exists(token_file):
        with open(token_file, encoding="utf-8") as f:
            return f.read().strip()
    return os.environ.get("GIT_TOKEN", "").strip()


def credentials_for(git_url: str) -> tuple[str, str] | None:
    """Return ``(username, token)`` for cloning ``git_url`` iff a token is configured for its host.

    The credential is meant to be passed to git via GIT_ASKPASS (see ASKPASS_PRELUDE) with
    ``GIT_USERNAME``/``GIT_PASSWORD`` env vars — NEVER embedded in the clone URL. Returns ``None``
    for an http(s) URL whose host doesn't match ``GIT_TOKEN_HOST``, a non-http(s) URL, or when no
    token is configured (anonymous clone)."""
    token = _read_token()
    host = os.environ.get("GIT_TOKEN_HOST", "").strip()
    if not token or not host:
        return None

    parts = urlsplit(git_url)
    if parts.scheme not in ("http", "https"):
        return None
    # Compare host only (strip any existing userinfo/port).
    if (parts.hostname or "").lower() != host.lower():
        return None
    # x-access-token is accepted by GitHub/GHE; the token is the password.
    return ("x-access-token", token)


def authenticated_url(git_url: str) -> str:
    """DEPRECATED — embeds the token in the URL. Use ``credentials_for`` + GIT_ASKPASS instead.

    Retained only for reference/back-compat; do NOT call it from a deploy path (the URL lands in
    a container command / object spec where the token is readable)."""
    creds = credentials_for(git_url)
    if creds is None:
        return git_url
    username, token = creds
    parts = urlsplit(git_url)
    netloc = parts.hostname or ""
    if parts.port:
        netloc = f"{netloc}:{parts.port}"
    netloc = f"{username}:{token}@{netloc}"
    return urlunsplit((parts.scheme, netloc, parts.path, parts.query, parts.fragment))
