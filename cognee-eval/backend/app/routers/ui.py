import os

from fastapi import APIRouter
from fastapi.responses import FileResponse

router = APIRouter()

_STATIC_DIR = os.path.join(os.path.dirname(__file__), "..", "static")


@router.get("/ui", include_in_schema=False)
async def serve_ui() -> FileResponse:
    return FileResponse(os.path.join(_STATIC_DIR, "index.html"))
