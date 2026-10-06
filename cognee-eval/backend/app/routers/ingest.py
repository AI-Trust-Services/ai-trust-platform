import os

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app import cognee_client

router = APIRouter(prefix="/ingest", tags=["ingest"])


class IngestRequest(BaseModel):
    path: str | None = None


@router.post("")
async def trigger_ingest(body: IngestRequest | None = None) -> dict:
    """Ingest a document into Cognee.

    Uses EU_AI_ACT_PDF_PATH env var by default. Pass {"path": "/data/file.txt"}
    in the request body to ingest a different file.
    """
    doc_path = (body.path if body and body.path else None) or os.environ.get(
        "EU_AI_ACT_PDF_PATH", "/data/EU-AI-ACT.pdf"
    )
    try:
        result = await cognee_client.ingest_pdf(doc_path)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    return result


@router.get("/status")
async def ingest_status() -> dict:
    """Check whether the EU AI Act has been ingested into Cognee."""
    return await cognee_client.get_ingest_status()
