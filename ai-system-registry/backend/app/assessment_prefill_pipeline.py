"""Pipeline 3 — AI-assessment prefill (orchestration).

Runs the two LLM pipelines for an assessment in order:

    1. questionnaire run   — ``questionnaire_pipeline.run_questionnaire_pipeline``
    2. classification run  — ``classification_pipeline.run_classification``
                             (only after step 1 has saved its result)

This module holds **no LLM, validation or storage logic of its own** — it only
sequences the two pipelines (which are also triggered one at a time by
``POST /questionnaire-llm-run`` and ``POST /classification-llm-run``) and decides
how failures propagate. It has no HTTP endpoint: it is started by
``POST /assessment/open`` as a background task.

The caller customises *persistence* through two optional hooks, so the pipelines
themselves stay side-effect free (apart from their MinIO result files):

* ``batch_callback`` — awaited with each questionnaire batch's results as it
  completes (``/open`` uses it to save answers into ``question_states``).
* ``on_questionnaire_done`` — awaited with the questionnaire output once step 1
  is done, **concurrently with** step 2 (``/open`` uses it for the tier step and
  to clear the "prefill pending" state, so the UI is ready as soon as it is).

Failure policy:
* step 1 fails → the exception propagates (nothing to classify);
* ``on_questionnaire_done`` raises → the exception propagates;
* step 2 fails as a whole → captured in ``PrefillOutput.classification_error``
  (logged) instead of raised: its output is not consumed by the UI yet, so it must
  not fail the prefill. Individual label failures are already handled inside
  ``run_classification``.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import Any, Awaitable, Callable

from ai_trust_logging import get_logger

from app.classification_pipeline import (
    DEFAULT_CLASSIFICATION_CONFIG_ID,
    DEFAULT_CLASSIFICATION_PROMPT_ID,
    run_classification,
)
from app.questionnaire_pipeline import (
    DEFAULT_QUESTIONNAIRE_ID,
    DEFAULT_QUESTIONNAIRE_PROMPT_ID,
    run_questionnaire_pipeline,
)

logger = get_logger(__name__)


@dataclass
class PrefillOutput:
    """Result of one prefill run.

    ``questionnaire`` / ``classification`` are the ``{run_key, presigned_url,
    result}`` dicts of the two pipelines. ``classification`` is ``None`` and
    ``classification_error`` is set when step 2 failed as a whole.
    """

    questionnaire: dict[str, Any]
    classification: dict[str, Any] | None = None
    classification_error: Exception | None = None


async def run_assessment_prefill_pipeline(
    system_id: str,
    username: str,
    *,
    questionnaire_id: str = DEFAULT_QUESTIONNAIRE_ID,
    questionnaire_prompt_id: str = DEFAULT_QUESTIONNAIRE_PROMPT_ID,
    classification_config_id: str = DEFAULT_CLASSIFICATION_CONFIG_ID,
    classification_prompt_id: str = DEFAULT_CLASSIFICATION_PROMPT_ID,
    batch_callback: Callable[[list[dict]], Awaitable[None]] | None = None,
    on_questionnaire_done: Callable[[dict[str, Any]], Awaitable[None]] | None = None,
) -> PrefillOutput:
    """Run the questionnaire pipeline, then the classification pipeline.

    Raises whatever step 1 or ``on_questionnaire_done`` raises; a step-2 failure
    is returned in ``PrefillOutput.classification_error`` (see module docstring).
    """
    # Step 1 — questionnaire run.
    questionnaire = await run_questionnaire_pipeline(
        system_id=system_id,
        questionnaire_id=questionnaire_id,
        prompt_id=questionnaire_prompt_id,
        username=username,
        batch_callback=batch_callback,
    )

    async def _done_hook() -> None:
        if on_questionnaire_done is not None:
            await on_questionnaire_done(questionnaire)

    # Step 2 — classification run, concurrently with the caller's post-step hook.
    classification, hook_outcome = await asyncio.gather(
        run_classification(
            system_id=system_id,
            questionnaire_run_key=questionnaire["run_key"],
            classification_config_id=classification_config_id,
            prompt_id=classification_prompt_id,
        ),
        _done_hook(),
        return_exceptions=True,
    )

    # Cancellation (a BaseException) must never be swallowed.
    for outcome in (classification, hook_outcome):
        if isinstance(outcome, BaseException) and not isinstance(outcome, Exception):
            raise outcome

    if isinstance(hook_outcome, Exception):
        raise hook_outcome

    if isinstance(classification, Exception):
        logger.warning(
            "assessment_prefill.classification_failed",
            extra={
                "system_id": system_id,
                "questionnaire_run_key": questionnaire["run_key"],
                "error": str(classification),
            },
        )
        return PrefillOutput(
            questionnaire=questionnaire, classification_error=classification
        )

    return PrefillOutput(questionnaire=questionnaire, classification=classification)
