"""Server-side manifest fetch with SSRF guards.

``POST /discover`` fetches a URL supplied by an operator, so it must not become a server-side
request forgery primitive. We allow only http/https, resolve the host and reject any address that
is loopback, link-local, reserved, multicast, or the cloud metadata IP, and cap the response time
and body size. Redirects are NOT followed (a 30x to an internal address would bypass the
pre-resolve check).

Private/RFC-1918 addresses are blocked by default but allowed when
``MARKETPLACE_ALLOW_PRIVATE_DISCOVERY`` is truthy — required for in-cluster / docker-compose deploys
where discovered apps legitimately live on a private network (every inter-container IP is private).
The cloud-metadata IPs and loopback/link-local are ALWAYS blocked regardless of that flag.
"""
from __future__ import annotations

import ipaddress
import os
import socket
from urllib.parse import urlparse

import httpx
from fastapi import HTTPException

_MAX_BODY_BYTES = 256 * 1024
_TIMEOUT_S = 8.0
_METADATA_IPS = {"169.254.169.254", "100.100.100.200"}


def _allow_private() -> bool:
    return os.environ.get("MARKETPLACE_ALLOW_PRIVATE_DISCOVERY", "").strip().lower() in (
        "1", "true", "yes", "on",
    )


def _reject_if_unsafe(host: str) -> None:
    """Resolve ``host`` and raise 400 if any resolved address is not an allowed target."""
    try:
        infos = socket.getaddrinfo(host, None)
    except socket.gaierror as exc:
        raise HTTPException(400, f"Could not resolve manifest host '{host}'") from exc
    allow_private = _allow_private()
    for info in infos:
        ip_str = info[4][0]
        if ip_str in _METADATA_IPS:
            raise HTTPException(400, "Manifest URL resolves to a blocked address")
        ip = ipaddress.ip_address(ip_str)
        # Always blocked, even with the private-allow flag.
        if ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast or ip.is_unspecified:
            raise HTTPException(400, "Manifest URL resolves to a non-public address")
        # RFC-1918 private ranges: blocked unless explicitly allowed (in-cluster deploys).
        if ip.is_private and not allow_private:
            raise HTTPException(400, "Manifest URL resolves to a non-public address")


async def fetch_manifest(url: str) -> dict:
    """Fetch and JSON-decode a well-known manifest, enforcing the SSRF guards."""
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise HTTPException(400, "Manifest URL must be http or https")
    if not parsed.hostname:
        raise HTTPException(400, "Manifest URL has no host")
    _reject_if_unsafe(parsed.hostname)

    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT_S, follow_redirects=False) as c:
            resp = await c.get(url, headers={"Accept": "application/json"})
    except httpx.HTTPError as exc:
        raise HTTPException(502, f"Could not fetch manifest: {exc}") from exc

    if resp.status_code >= 400:
        raise HTTPException(502, f"Manifest fetch returned {resp.status_code}")
    if len(resp.content) > _MAX_BODY_BYTES:
        raise HTTPException(502, "Manifest is too large")
    try:
        return resp.json()
    except ValueError as exc:
        raise HTTPException(502, "Manifest is not valid JSON") from exc


async def probe(url: str) -> bool:
    """Liveness probe for a discovered app's operator-supplied ``health_url``.

    Reuses the SSRF guard (``_reject_if_unsafe`` + no-redirect + timeout) — an off-cluster health
    URL has the same forgery surface as a manifest fetch. Returns ``True`` when the endpoint answers
    2xx/3xx within the timeout, ``False`` on any other status or a network error. Raises
    ``HTTPException`` only for an unsafe/blocked target (scheme, no host, resolves non-public) so the
    worker can skip it (never record a false "down") — a genuinely dead app just returns ``False``.
    """
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise HTTPException(400, "Health URL must be http or https")
    if not parsed.hostname:
        raise HTTPException(400, "Health URL has no host")
    _reject_if_unsafe(parsed.hostname)

    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT_S, follow_redirects=False) as c:
            resp = await c.get(url, headers={"Accept": "*/*"})
    except httpx.HTTPError:
        return False
    return 200 <= resp.status_code < 400
