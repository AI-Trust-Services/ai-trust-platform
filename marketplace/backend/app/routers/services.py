from __future__ import annotations

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import Response
from sqlalchemy import select

from ai_trust_authorization import require_permission
from ai_trust_authorization.constants import MARKETPLACE_MANAGE
from ai_trust_logging import get_logger
from ai_trust_persistence import SessionLocal
from ai_trust_persistence.models.marketplace import MarketplaceService

from app import deploy
from app.ids import new_id
from app.schemas import ServiceCreate, ServiceResponse

router = APIRouter(tags=["services"])
logger = get_logger(__name__)

# Hop-by-hop headers that must not be forwarded through the proxy.
_HOP_BY_HOP = {
    "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
    "te", "trailers", "transfer-encoding", "upgrade", "content-length", "content-encoding",
}


@router.get("/services", response_model=list[ServiceResponse])
async def list_services(
    status: str | None = Query(default=None, description="Filter by status, e.g. 'running'"),
) -> list[ServiceResponse]:
    """Catalog listing. No permission gate: read-only, and luigi-config.js (unauth-safe) calls
    this with ?status=running to build the Services menu. Mutations below are gated."""
    async with SessionLocal() as session:
        stmt = select(MarketplaceService).order_by(MarketplaceService.label)
        if status:
            stmt = stmt.where(MarketplaceService.status == status)
        result = await session.execute(stmt)
        return [ServiceResponse.model_validate(r) for r in result.scalars().all()]


@router.post("/services", response_model=ServiceResponse, status_code=201,
             dependencies=[Depends(require_permission(MARKETPLACE_MANAGE))])
async def add_service(body: ServiceCreate) -> ServiceResponse:
    async with SessionLocal() as session:
        exists = await session.execute(
            select(MarketplaceService).where(MarketplaceService.name == body.name)
        )
        if exists.scalar_one_or_none():
            raise HTTPException(409, f"A service named '{body.name}' already exists")

        row = MarketplaceService(
            id=new_id("MKT"),
            name=body.name,
            label=body.label,
            git_url=body.git_url,
            git_ref=body.git_ref,
            kind="static",
            source=body.source,
            open_mode=body.open_mode if body.source == "external" else "same_window",
            status="running" if body.source == "external" else "pending",
            # For external services there is nothing to deploy — store the URL to open.
            service_host=body.external_url if body.source == "external" else None,
        )
        session.add(row)
        await session.commit()
        await session.refresh(row)
    logger.info("marketplace.service.added", extra={"id": row.id, "service": row.name, "source": row.source})
    return ServiceResponse.model_validate(row)


@router.post("/services/{service_id}/deploy", response_model=ServiceResponse,
             dependencies=[Depends(require_permission(MARKETPLACE_MANAGE))])
async def deploy_service(service_id: str) -> ServiceResponse:
    async with SessionLocal() as session:
        row = (await session.execute(
            select(MarketplaceService).where(MarketplaceService.id == service_id)
        )).scalar_one_or_none()
        if not row:
            raise HTTPException(404, f"Service {service_id} not found")
        if row.source == "external":
            raise HTTPException(400, "External services are not deployed by the platform")

        row.status = "deploying"
        row.error = None
        await session.commit()
        name, git_url, git_ref = row.name, row.git_url, row.git_ref

    try:
        host = await deploy.create_static_service(name, git_url, git_ref)
        new_status, err = "running", None
    except Exception as e:  # noqa: BLE001 — record any failure on the row
        logger.exception("marketplace.deploy.failed", extra={"id": service_id, "service": name})
        host, new_status, err = None, "failed", str(e)[:2000]

    async with SessionLocal() as session:
        row = (await session.execute(
            select(MarketplaceService).where(MarketplaceService.id == service_id)
        )).scalar_one_or_none()
        if not row:
            raise HTTPException(404, f"Service {service_id} not found")
        row.status = new_status
        row.service_host = host
        row.error = err
        await session.commit()
        await session.refresh(row)
    logger.info("marketplace.deploy.done", extra={"id": service_id, "service": name, "status": new_status})
    return ServiceResponse.model_validate(row)


@router.get("/services/{service_id}/status", response_model=ServiceResponse)
async def get_status(service_id: str) -> ServiceResponse:
    async with SessionLocal() as session:
        row = (await session.execute(
            select(MarketplaceService).where(MarketplaceService.id == service_id)
        )).scalar_one_or_none()
        if not row:
            raise HTTPException(404, f"Service {service_id} not found")
        return ServiceResponse.model_validate(row)


@router.delete("/services/{service_id}",
               dependencies=[Depends(require_permission(MARKETPLACE_MANAGE))])
async def delete_service(service_id: str) -> dict:
    async with SessionLocal() as session:
        row = (await session.execute(
            select(MarketplaceService).where(MarketplaceService.id == service_id)
        )).scalar_one_or_none()
        if not row:
            raise HTTPException(404, f"Service {service_id} not found")
        name, source = row.name, row.source
        await session.delete(row)
        await session.commit()

    if source == "internal":
        try:
            await deploy.delete_service(name)
        except Exception as e:  # noqa: BLE001
            logger.warning("marketplace.delete.k8s_failed", extra={"service": name, "error": str(e)})
    logger.info("marketplace.service.deleted", extra={"id": service_id, "service": name})
    return {"status": "deleted", "id": service_id, "name": name}


@router.api_route(
    "/proxy/{name}/{path:path}",
    methods=["GET", "HEAD", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
)
async def proxy(name: str, path: str, request: Request) -> Response:
    """Reverse-proxy to a running internal service so it is embeddable SAME-ORIGIN through the
    shell (CSP frame-ancestors 'self'). The Luigi node's viewUrl iframes /marketplace/#/embed/<name>,
    whose page loads assets from /api/marketplace/v1/proxy/<name>/."""
    async with SessionLocal() as session:
        row = (await session.execute(
            select(MarketplaceService).where(MarketplaceService.name == name)
        )).scalar_one_or_none()
    if not row or row.source != "internal":
        raise HTTPException(404, f"No internal service '{name}'")
    if row.status != "running" or not row.service_host:
        raise HTTPException(409, f"Service '{name}' is not running (status={row.status})")

    target = f"http://{row.service_host}/{path}"
    fwd_headers = {
        k: v for k, v in request.headers.items()
        if k.lower() not in _HOP_BY_HOP and k.lower() != "host"
    }
    body = await request.body()
    try:
        async with httpx.AsyncClient(timeout=30.0) as up:
            upstream = await up.request(
                request.method, target, params=request.query_params,
                headers=fwd_headers, content=body,
            )
    except httpx.HTTPError as e:
        raise HTTPException(502, f"Upstream '{name}' unreachable: {e}") from e

    resp_headers = {
        k: v for k, v in upstream.headers.items() if k.lower() not in _HOP_BY_HOP
    }
    return Response(
        content=upstream.content,
        status_code=upstream.status_code,
        headers=resp_headers,
        media_type=upstream.headers.get("content-type"),
    )
