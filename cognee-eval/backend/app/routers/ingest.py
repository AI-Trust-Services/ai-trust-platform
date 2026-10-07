import tempfile
from pathlib import Path

from fastapi import APIRouter, HTTPException, UploadFile

from app import cognee_client

router = APIRouter(prefix="/ingest", tags=["ingest"])

_MAX_UPLOAD_BYTES = 50 * 1024 * 1024  # 50 MB


@router.post("")
async def trigger_ingest(file: UploadFile) -> dict:
    """Ingest a document into Cognee.

    Upload a PDF file (multipart/form-data, field name: file).
    Runs the full cognee pipeline: extraction → chunking → embedding → graph build.
    """
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are supported")

    contents = await file.read()
    if len(contents) > _MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="File too large (max 50 MB)")

    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
        tmp.write(contents)
        tmp_path = tmp.name

    try:
        result = await cognee_client.ingest_pdf(tmp_path)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    finally:
        Path(tmp_path).unlink(missing_ok=True)

    return result


@router.get("/status")
async def ingest_status() -> dict:
    """Check whether the EU AI Act has been ingested into Cognee."""
    return await cognee_client.get_ingest_status()
