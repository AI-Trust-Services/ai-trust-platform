"""Marketplace Health Worker — probes discovered apps' health_url on a fixed interval.

Standalone background job (no HTTP port), mirroring policy-checker-worker: its own async engine +
session, a ``while True`` loop, and no FastAPI. Every ``MARKETPLACE_HEALTH_INTERVAL`` seconds it
probes each ``external_discovered`` marketplace row that has a non-null ``health_url`` and writes
back ``health_status`` ("up"/"down") + ``health_checked_at``.

The probe carries the SAME SSRF guard the marketplace backend uses for manifest fetches
(``app.discovery._reject_if_unsafe``) — an operator-supplied health URL is an equally-forgeable
target. The guard is reproduced here self-contained (constants + resolve/reject) so this worker's
image needs only libs/persistence + libs/logging, not the whole marketplace backend. A blocked
target is skipped (never recorded as a false "down") and logged.

The marketplace is NOT tenant-scoped (discovered apps are platform-global; the marketplace-backend
runs single-tenant), so unlike policy-checker-worker there is no per-tenant pass — a single unscoped
loop over the public schema.
"""
import asyncio
import ipaddress
import logging
import os
import socket
from datetime import datetime, timezone
from urllib.parse import urlparse

import httpx
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from ai_trust_logging import get_logger
from ai_trust_persistence.models.marketplace import MarketplaceService

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = get_logger(__name__)

DATABASE_URL = os.environ["DATABASE_URL"]
POLL_INTERVAL = int(os.environ.get("MARKETPLACE_HEALTH_INTERVAL", "30"))

engine = create_async_engine(DATABASE_URL, pool_pre_ping=True)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False)

# ── SSRF guard (self-contained mirror of app.discovery) ──────────────────────────────────────────
_TIMEOUT_S = 8.0
_METADATA_IPS = {"169.254.169.254", "100.100.100.200"}


def _allow_private() -> bool:
    return os.environ.get("MARKETPLACE_ALLOW_PRIVATE_DISCOVERY", "").strip().lower() in (
        "1", "true", "yes", "on",
    )


class UnsafeTarget(Exception):
    """The health URL resolves to a blocked/non-public address — skip, never record "down"."""


def _reject_if_unsafe(host: str) -> None:
    try:
        infos = socket.getaddrinfo(host, None)
    except socket.gaierror as exc:
        raise UnsafeTarget(f"could not resolve host '{host}'") from exc
    allow_private = _allow_private()
    for info in infos:
        ip_str = info[4][0]
        if ip_str in _METADATA_IPS:
            raise UnsafeTarget("resolves to a blocked address")
        ip = ipaddress.ip_address(ip_str)
        if ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast or ip.is_unspecified:
            raise UnsafeTarget("resolves to a non-public address")
        if ip.is_private and not allow_private:
            raise UnsafeTarget("resolves to a non-public address")


async def probe(url: str) -> bool:
    """True when the health URL answers 2xx/3xx within the timeout; False on any other status or a
    network error. Raises ``UnsafeTarget`` for a blocked/non-public target (caller skips it)."""
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise UnsafeTarget("health URL must be http or https")
    if not parsed.hostname:
        raise UnsafeTarget("health URL has no host")
    _reject_if_unsafe(parsed.hostname)

    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT_S, follow_redirects=False) as c:
            resp = await c.get(url, headers={"Accept": "*/*"})
    except httpx.HTTPError:
        return False
    return 200 <= resp.status_code < 400


async def probe_all() -> None:
    """One pass: probe every discovered row with a health_url and write back the outcome."""
    async with SessionLocal() as session:
        rows = (
            await session.execute(
                select(MarketplaceService.id, MarketplaceService.name, MarketplaceService.health_url)
                .where(MarketplaceService.source == "external_discovered")
                .where(MarketplaceService.health_url.isnot(None))
            )
        ).all()

        for app_id, name, health_url in rows:
            try:
                up = await probe(health_url)
            except UnsafeTarget as exc:
                log.warning(
                    "marketplace_health_worker.skipped_unsafe",
                    extra={"service": name, "reason": str(exc)},
                )
                continue
            except Exception:  # noqa: BLE001
                log.exception("marketplace_health_worker.probe_error", extra={"service": name})
                up = False

            await session.execute(
                update(MarketplaceService)
                .where(MarketplaceService.id == app_id)
                .values(
                    health_status="up" if up else "down",
                    health_checked_at=datetime.now(timezone.utc),
                )
            )
        await session.commit()


async def main() -> None:
    log.info("marketplace_health_worker.started", extra={"poll_interval": POLL_INTERVAL})
    while True:
        try:
            await probe_all()
        except Exception:  # noqa: BLE001
            log.exception("marketplace_health_worker.cycle_failed")
        await asyncio.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    asyncio.run(main())
