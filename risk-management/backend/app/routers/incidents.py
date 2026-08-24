from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import JSONResponse

from ai_trust_logging import get_logger
from app.schemas.incident import (
    IncidentIngestRequest,
    IncidentIngestResponse,
    IncidentListResponse,
)

router = APIRouter(tags=["post-market monitoring"])
logger = get_logger(__name__)

_INCIDENTS_DIR = Path(__file__).parent.parent.parent / "output" / "incidents"
_INCIDENTS_DIR.mkdir(parents=True, exist_ok=True)


def _incidents_file(register_id: str) -> Path:
    return _INCIDENTS_DIR / f"{register_id}.jsonl"


@router.post("/incidents/webhook", response_model=IncidentIngestResponse)
async def ingest_incident_webhook(body: IncidentIngestRequest) -> IncidentIngestResponse:
    """
    Ingest a post-market monitoring incident via JSON webhook (Art. 9(2)(c)).
    Associates the incident with an existing risk register.
    """
    record = body.model_dump()
    _append_incident(body.register_id, record)
    logger.info(
        "incident.ingested",
        extra={
            "register_id": body.register_id,
            "title": body.title,
            "severity": body.severity,
            "source": "webhook",
        },
    )
    return IncidentIngestResponse(
        message="Incident recorded",
        register_id=body.register_id,
        incident_id=body.incident_id,
    )


@router.post("/incidents/upload", response_model=IncidentIngestResponse)
async def ingest_incident_file(
    register_id: str = Form(...),
    title: str = Form(...),
    description: str = Form(...),
    severity: str = Form("medium"),
    source: str = Form("manual_upload"),
    file: UploadFile = File(...),
) -> IncidentIngestResponse:
    """
    Ingest a post-market monitoring incident via file upload (Art. 9(2)(c)).
    Accepts JSON or plain text reports; stores the content alongside the incident record.
    """
    import uuid

    incident_id = f"INC-{uuid.uuid4().hex[:8].upper()}"
    content_bytes = await file.read()
    try:
        content_text = content_bytes.decode("utf-8")
    except UnicodeDecodeError:
        content_text = content_bytes.decode("latin-1", errors="replace")

    record: dict[str, Any] = {
        "incident_id": incident_id,
        "register_id": register_id,
        "title": title,
        "description": description,
        "severity": severity,
        "source": source,
        "filename": file.filename,
        "file_content_preview": content_text[:500],
    }

    _append_incident(register_id, record)
    logger.info(
        "incident.ingested",
        extra={
            "register_id": register_id,
            "incident_id": incident_id,
            "title": title,
            "filename": file.filename,
            "source": "file_upload",
        },
    )
    return IncidentIngestResponse(
        message="Incident recorded from file upload",
        register_id=register_id,
        incident_id=incident_id,
    )


@router.get("/incidents/{register_id}", response_model=IncidentListResponse)
async def list_incidents(register_id: str) -> IncidentListResponse:
    """
    Return all post-market monitoring incidents for a given risk register.
    """
    incidents_file = _incidents_file(register_id)
    if not incidents_file.exists():
        return IncidentListResponse(register_id=register_id, incidents=[])

    incidents: list[dict[str, Any]] = []
    for line in incidents_file.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line:
            try:
                incidents.append(json.loads(line))
            except json.JSONDecodeError:
                pass

    return IncidentListResponse(register_id=register_id, incidents=incidents)


def _append_incident(register_id: str, record: dict[str, Any]) -> None:
    f = _incidents_file(register_id)
    with f.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(record, default=str) + "\n")
