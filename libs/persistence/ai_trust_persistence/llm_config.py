"""Bring-your-own-LLM provider resolution + endpoint validation (issue #406).

Two concerns, shared by the registry (reads config at request time) and the
admin backend (validates + persists config):

1. ``validate_endpoint_url`` — SSRF guard. The admin types an arbitrary URL and
   the platform then makes server-side requests to it, so an un-validated value
   could point at internal services (``http://openfga:8080``), loopback, or the
   cloud metadata endpoint (``169.254.169.254``). Returns ``None`` when the URL is
   safe, or a human-readable reason string when it must be rejected. Resolves the
   hostname and checks every resolved IP, so a public hostname that resolves to a
   private address (DNS rebinding) is still caught.

2. ``resolve_llm_config`` — reads the single ``llm_provider_config`` row for the
   current schema (= current tenant in ``jwt`` mode). Returns an ``LLMConfig`` when
   a row exists and ``is_active``; otherwise ``None``, meaning "use the
   platform-default Thalamus env config". There is **no silent fallback** between
   an active BYO provider and Thalamus at request time — a failing active provider
   surfaces as an error upstream.
"""

from __future__ import annotations

import ipaddress
import socket
from dataclasses import dataclass
from urllib.parse import urlparse

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ai_trust_persistence.models.llm_provider_config import LLMProviderConfig


@dataclass(frozen=True)
class LLMConfig:
    base_url: str
    api_token: str
    model: str


def _ip_is_blocked(ip: str) -> bool:
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return False
    # Private (RFC1918), loopback, link-local (incl. 169.254.169.254 metadata),
    # reserved, and unspecified addresses are all off-limits for a provider URL.
    return (
        addr.is_private
        or addr.is_loopback
        or addr.is_link_local
        or addr.is_reserved
        or addr.is_unspecified
    )


def validate_endpoint_url(url: str | None) -> str | None:
    """Return None if the URL is a safe external endpoint, else a reason string.

    Policy: https-only; loopback, private (RFC1918), link-local/metadata, and
    reserved addresses are always rejected. A BYO provider endpoint is a public
    third-party service, so there is no localhost/internal carve-out.
    """
    if not url or not url.strip():
        return "Endpoint URL is required."
    parsed = urlparse(url.strip())
    if parsed.scheme not in ("http", "https"):
        return "Endpoint URL must use http or https."
    host = parsed.hostname
    if not host:
        return "Endpoint URL has no host."
    if parsed.scheme != "https":
        return "Endpoint URL must use https."

    # Resolve the host and reject if ANY resolved address is internal. This
    # catches a public-looking hostname that resolves to a private/loopback IP.
    # A DNS-resolution FAILURE is not an SSRF signal (the host simply can't be
    # reached) — pass it here and let the actual connection / Test Connection
    # surface "endpoint unreachable", rather than false-rejecting a good endpoint
    # during a DNS blip. A literal internal IP still resolves to itself and is
    # caught below.
    try:
        infos = socket.getaddrinfo(host, parsed.port or None)
    except socket.gaierror:
        return None
    for info in infos:
        ip = info[4][0]
        if _ip_is_blocked(ip):
            return (
                f"Endpoint host '{host}' resolves to a non-routable/internal "
                f"address ({ip}) and is not allowed."
            )
    return None


async def resolve_llm_config(session: AsyncSession) -> LLMConfig | None:
    """Return the active BYO provider config, or None to use the platform default.

    None is returned when there is no config row, the row is not active, or the
    row is missing any of the three required fields.
    """
    row = await session.get(LLMProviderConfig, 1)
    if row is None or not row.is_active:
        return None
    if not (row.base_url and row.api_token and row.model):
        return None
    return LLMConfig(base_url=row.base_url, api_token=row.api_token, model=row.model)
