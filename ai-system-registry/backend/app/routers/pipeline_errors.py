"""HTTP mapping of pipeline errors, shared by the pipeline trigger endpoints."""

from __future__ import annotations

from fastapi import HTTPException

from app.classification_pipeline import InvalidRunKeyError
from app.llm.parsing import LLMParseError
from app.llm.templates import PromptTemplateError


def map_pipeline_error(exc: Exception) -> HTTPException:
    """Translate a pipeline exception into the HTTP error the endpoints return.

    * 404 — system, MinIO result, questionnaire/config or prompt file not found
    * 422 — the questionnaire run key does not belong to the system
    * 502 — the LLM produced no valid output after the retries

    Anything else is re-raised unchanged (→ 500).
    """
    if isinstance(exc, (KeyError, PromptTemplateError)):
        return HTTPException(status_code=404, detail=str(exc))
    if isinstance(exc, InvalidRunKeyError):
        return HTTPException(status_code=422, detail=str(exc))
    if isinstance(exc, LLMParseError):
        return HTTPException(
            status_code=502,
            detail=f"LLM returned unusable output: {exc}",
        )
    raise exc
