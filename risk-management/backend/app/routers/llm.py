from __future__ import annotations

import os

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from ai_trust_logging import get_logger
from app.schemas.llm import LLMStatusResponse

router = APIRouter(tags=["llm"])
logger = get_logger(__name__)


@router.get("/llm/status", response_model=LLMStatusResponse)
async def llm_status() -> LLMStatusResponse:
    from risk_management.config import AppConfig
    from risk_management.llm_client import OllamaClient

    base_url = os.environ.get("OLLAMA_BASE_URL", "http://localhost:11434")
    model = os.environ.get("OLLAMA_MODEL", "llama3.2")

    client = OllamaClient(base_url=base_url, model=model, temperature=0.2, timeout=5)
    available = False
    try:
        available = client.is_available()
    except Exception:
        pass

    logger.info("llm.status_checked", extra={"available": available, "model": model})
    return LLMStatusResponse(available=available, model=model, base_url=base_url)
