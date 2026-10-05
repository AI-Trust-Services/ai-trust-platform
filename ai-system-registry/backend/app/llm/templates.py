"""External prompt-template loader for AI-assisted registration.

Prompt wording lives outside application code in ``context/prompts/*.md`` (one
file per model-call system prompt, named by a stable template id). This module
resolves that directory, loads a template by id, and renders it by substituting
``{variable}`` placeholders the caller supplies.

Design notes:
  - Only the variables the caller passes are substituted, via explicit token
    replacement — so the ``{ ... }`` JSON-shape examples in the prompt body are
    left untouched (no ``{{``/``}}`` escaping needed in the template files).
  - A missing template file or a missing required variable raises
    ``PromptTemplateError`` with an actionable message (names the id, the
    searched path, or the missing variable).
  - Every render logs ``prompt.rendered`` with ``template_id`` + ``template_path``
    so a model call is traceable to the exact template file; git provides the
    revision and the diff between two versions.
"""

from __future__ import annotations

import os
import re
from functools import lru_cache
from pathlib import Path

from ai_trust_logging import get_logger

logger = get_logger(__name__)


class PromptTemplateError(Exception):
    """Raised when a template is missing or a required variable is not supplied."""


# Matches a single ``{name}`` placeholder (identifier only). The JSON-shape
# examples in the prompts use ``{"message": ...}`` / ``{<field>}`` which do not
# match this pattern, so they are never treated as variables.
_PLACEHOLDER_RE = re.compile(r"\{([A-Za-z_][A-Za-z0-9_]*)\}")


def _resolve_prompts_dir() -> Path:
    """Locate ``context/prompts``.

    Precedence: the ``PROMPTS_DIR`` env var (used in prod/tests when the layout
    differs), else walk up from this file to find a ``context/prompts`` dir.
    This resolves both in Docker (``/app/context/prompts`` with WORKDIR
    ``/app``) and in local/test runs from ``ai-system-registry/backend`` where
    the repo-root dir is ``../../context/prompts``.
    """
    override = os.environ.get("PROMPTS_DIR")
    if override:
        return Path(override)
    for parent in Path(__file__).resolve().parents:
        candidate = parent / "context" / "prompts"
        if candidate.is_dir():
            return candidate
    # Fall back to the Docker layout so the error message points somewhere real.
    return Path("/app/context/prompts")


@lru_cache(maxsize=None)
def load_template(template_id: str) -> str:
    """Read ``<prompts_dir>/<template_id>.md``. Cached by id.

    Raises ``PromptTemplateError`` naming the id and the searched path when the
    file does not exist.
    """
    prompts_dir = _resolve_prompts_dir()
    path = prompts_dir / f"{template_id}.md"
    if not path.is_file():
        raise PromptTemplateError(
            f"Prompt template '{template_id}' not found at '{path}'. "
            f"Templates live in context/prompts/ (set PROMPTS_DIR to override)."
        )
    return path.read_text(encoding="utf-8")


def render_template(template_id: str, **variables: str) -> str:
    """Load ``template_id`` and substitute its ``{name}`` placeholders.

    Every ``{name}`` placeholder in the template must be supplied in
    ``variables``; a missing one raises ``PromptTemplateError`` naming the
    variable and template. Only declared placeholders are replaced, so JSON
    braces in the prompt body pass through unchanged.
    """
    text = load_template(template_id)

    required = set(_PLACEHOLDER_RE.findall(text))
    missing = required - set(variables)
    if missing:
        raise PromptTemplateError(
            f"Prompt template '{template_id}' requires variable(s) "
            f"{sorted(missing)} that were not supplied."
        )

    for name, value in variables.items():
        text = text.replace("{" + name + "}", value)

    prompts_dir = _resolve_prompts_dir()
    logger.info(
        "prompt.rendered",
        extra={
            "template_id": template_id,
            "template_path": str(prompts_dir / f"{template_id}.md"),
        },
    )
    return text
