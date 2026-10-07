import os
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app import cognee_client

router = APIRouter(prefix="/ingest", tags=["ingest"])

_DATA_DIR = Path("/data").resolve()


class IngestRequest(BaseModel):
    path: str | None = None


@router.post("")
async def trigger_ingest(body: IngestRequest | None = None) -> dict:
    """Ingest a document into Cognee.

    Uses EU_AI_ACT_PDF_PATH env var by default. Pass {"path": "file.txt"}
    to ingest a different file from the /data directory.
    """
    if body and body.path:
        resolved = (_DATA_DIR / Path(body.path).name).resolve()
        if not str(resolved).startswith(str(_DATA_DIR)):
            raise HTTPException(status_code=400, detail="Path outside allowed directory")
        doc_path = str(resolved)
    else:
        doc_path = os.environ.get("EU_AI_ACT_PDF_PATH", "/data/EU-AI-ACT.pdf")
    try:
        result = await cognee_client.ingest_pdf(doc_path)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    return result


@router.get("/status")
async def ingest_status() -> dict:
    """Check whether the EU AI Act has been ingested into Cognee."""
    return await cognee_client.get_ingest_status()
