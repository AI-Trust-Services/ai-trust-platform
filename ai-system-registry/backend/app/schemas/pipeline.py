"""Response schema shared by the LLM pipeline trigger endpoints."""

from __future__ import annotations

from pydantic import BaseModel, Field


class PipelineStepOutput(BaseModel):
    """Output of one pipeline run (questionnaire or classification)."""

    run_key: str = Field(description="MinIO object key of the stored result file.")
    presigned_url: str = Field(description="Download URL for the result, valid 24 h.")
    result: dict = Field(description="The full parsed result of this run.")
