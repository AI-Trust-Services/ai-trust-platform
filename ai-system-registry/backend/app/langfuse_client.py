"""Thin, fail-soft wrapper around the Langfuse client.

Langfuse tracing is an **optional** feature — same convention as SMTP email in
the registry backend. When ``LANGFUSE_HOST`` / ``LANGFUSE_PUBLIC_KEY`` /
``LANGFUSE_SECRET_KEY`` are unset (local dev, CI), ``is_enabled()`` is False and
``get_langfuse()`` returns ``None`` so callers degrade gracefully instead of
crashing on import or at startup.

A trace's project is fixed by the API key pair; per-deployment separation is
done with the Langfuse **environment** (``LANGFUSE_TRACING_ENVIRONMENT``), which
``k8s/scripts/bootstrap.sh`` / the CI deploy sets to the deployment's namespace
(= the GitHub username of whoever triggered the deploy). The SDK reads that env
var directly; we also pass it explicitly so the value is unambiguous.
"""

from __future__ import annotations

import os
from functools import lru_cache

from ai_trust_logging import get_logger

logger = get_logger(__name__)


def _host() -> str:
    return os.environ.get("LANGFUSE_HOST", "").strip()


def _public_key() -> str:
    return os.environ.get("LANGFUSE_PUBLIC_KEY", "").strip()


def _secret_key() -> str:
    return os.environ.get("LANGFUSE_SECRET_KEY", "").strip()


def tracing_environment() -> str:
    """The Langfuse environment (per-deployment project discriminator).

    Defaults to ``default`` when unset, matching the SDK's own fallback.
    """
    return os.environ.get("LANGFUSE_TRACING_ENVIRONMENT", "").strip() or "default"


def is_enabled() -> bool:
    """True only when host + both keys are configured."""
    return bool(_host() and _public_key() and _secret_key())


def host() -> str:
    """The configured Langfuse base URL (empty string when disabled)."""
    return _host()


@lru_cache(maxsize=1)
def get_langfuse():
    """Return a cached ``Langfuse`` client, or ``None`` when tracing is disabled.

    The client is a singleton; caching here avoids re-reading env and rebuilding
    it on every request. Import of the ``langfuse`` package is deferred so the
    module stays importable even if the dependency is somehow missing.
    """
    if not is_enabled():
        return None
    try:
        from langfuse import Langfuse

        return Langfuse(
            host=_host(),
            public_key=_public_key(),
            secret_key=_secret_key(),
            environment=tracing_environment(),
        )
    except Exception as e:  # pragma: no cover - defensive, tracing is best-effort
        logger.warning("langfuse.client_init_failed", extra={"error": str(e)})
        return None
