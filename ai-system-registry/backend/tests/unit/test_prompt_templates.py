"""Unit tests for the external prompt-template loader (app/llm/templates.py).

These prove the issue's acceptance criteria:
  - templates render from context/prompts/*.md with named variables substituted,
  - a missing template or missing required variable fails with an actionable error,
  - the JSON-shape braces in the prompt body survive rendering unchanged,
  - every build_* function still produces well-formed messages off the templates.

No DB and no network — the stub provider is never invoked here.
"""

from __future__ import annotations

import pytest

from app.llm import prompts
from app.llm.templates import (
    PromptTemplateError,
    load_template,
    render_template,
)


# ---------------------------------------------------------------------------
# load / render happy path
# ---------------------------------------------------------------------------


def test_load_template_reads_file():
    text = load_template("owner_turn")
    assert "AI registration assistant" in text
    # Unsubstituted placeholder is still present before rendering.
    assert "{target_schema}" in text


def test_render_substitutes_named_variable():
    rendered = render_template("owner_turn", target_schema="- foo — a thing")
    assert "- foo — a thing" in rendered
    assert "{target_schema}" not in rendered


def test_render_preserves_json_shape_braces():
    """The JSON example braces are not variables and must pass through verbatim."""
    rendered = render_template("owner_turn", target_schema="x")
    assert '"message":' in rendered
    assert '"extracted_fields":' in rendered
    # No stray single-brace variable syntax leaked through.
    assert "{target_schema}" not in rendered


# ---------------------------------------------------------------------------
# actionable errors (AC: missing template / missing variable)
# ---------------------------------------------------------------------------


def test_missing_template_raises_with_id_and_path():
    with pytest.raises(PromptTemplateError) as exc:
        load_template("does_not_exist")
    msg = str(exc.value)
    assert "does_not_exist" in msg
    # Message names the searched path so the failure is diagnosable.
    assert "context" in msg and "prompts" in msg


def test_missing_required_variable_raises_naming_it():
    with pytest.raises(PromptTemplateError) as exc:
        render_template("owner_turn")  # target_schema not supplied
    msg = str(exc.value)
    assert "owner_turn" in msg
    assert "target_schema" in msg


def test_unknown_extra_variable_is_ignored():
    """Supplying a variable the template doesn't use is harmless."""
    rendered = render_template("owner_turn", target_schema="x", bogus="y")
    assert "x" in rendered


# ---------------------------------------------------------------------------
# every externalized builder resolves + renders (smoke)
# ---------------------------------------------------------------------------


def _assert_system_message(messages: list[dict]):
    assert messages
    assert messages[0]["role"] == "system"
    assert isinstance(messages[0]["content"], str)
    assert len(messages[0]["content"]) > 0


def test_owner_builders_render():
    _assert_system_message(prompts.build_turn_messages([], {}))
    _assert_system_message(prompts.build_doc_extract_messages(parsed_text="doc"))
    _assert_system_message(prompts.build_infer_flags_messages({}))


def test_engineer_builders_render():
    _assert_system_message(prompts.build_engineer_turn_messages([], {}))
    _assert_system_message(
        prompts.build_engineer_doc_extract_messages(parsed_text="doc")
    )


@pytest.mark.parametrize("section", ["business", "technical"])
def test_questionnaire_builders_render(section: str):
    _assert_system_message(
        prompts.build_questionnaire_turn_messages(section, [], {}, {})
    )
    _assert_system_message(
        prompts.build_questionnaire_extract_messages(section, parsed_text="doc")
    )


def test_classify_builder_renders():
    _assert_system_message(prompts.build_classify_questionnaire_messages({}, {}))


def test_json_repair_templates_render():
    """The JSON auto-repair chat() call renders both prompts from templates."""
    system = render_template("json_repair_system")
    assert "valid JSON object" in system
    user = render_template("json_repair_user", malformed_response="not json {oops}")
    # The malformed response is embedded verbatim, including any stray braces.
    assert "not json {oops}" in user
    assert "{malformed_response}" not in user


def test_every_template_id_has_a_file():
    """All ids the builders reference must resolve to a template on disk."""
    ids = [
        "owner_turn",
        "owner_doc_extract",
        "infer_flags",
        "engineer_turn",
        "engineer_doc_extract",
        "questionnaire_business_turn",
        "questionnaire_technical_turn",
        "questionnaire_business_doc_extract",
        "questionnaire_technical_doc_extract",
        "classify_questionnaire",
        "json_repair_system",
        "json_repair_user",
    ]
    for template_id in ids:
        assert load_template(template_id)
