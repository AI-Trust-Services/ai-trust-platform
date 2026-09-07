"""Startup guard: refuse to boot with known-default secrets in a multi-tenant deployment.

SEC-M4: `.env.example` ships placeholder credentials (POSTGRES_PASSWORD=postgres,
APP_ADMIN_PASSWORD=password, MINIO_ROOT_PASSWORD=minioadmin, …). Those are fine for local
single-tenant dev, but must never reach a shared multi-tenant deployment. This check is
called from each backend's main.py; it raises (aborting startup) if any known-default
secret is still set AND TENANCY_MODE != single.
"""
from __future__ import annotations

import os

from ai_trust_tenancy.config import MODE

# env var -> the known-default value that must be overridden in non-single mode.
_KNOWN_DEFAULTS = {
    "POSTGRES_PASSWORD": "postgres",
    "APP_ADMIN_PASSWORD": "password",
    "MINIO_ROOT_PASSWORD": "minioadmin",
    "KEYCLOAK_ADMIN_PASSWORD": "admin",
    "RABBITMQ_PASSWORD": "guest",
}


def check_no_default_secrets() -> None:
    """Raise RuntimeError if a known-default secret is unchanged while TENANCY_MODE != single.

    No-op in single mode (local/dev), so the existing single-tenant deploy is unaffected.
    """
    if MODE == "single":
        return
    offenders = [
        name for name, default in _KNOWN_DEFAULTS.items()
        if os.environ.get(name, "") == default
    ]
    if offenders:
        raise RuntimeError(
            "Refusing to start: known-default credentials must be overridden when "
            f"TENANCY_MODE={MODE!r} (multi-tenant). Offending env vars: {', '.join(sorted(offenders))}."
        )
