# Prompt templates (`context/prompts/`)

Externalized LLM system prompts for AI Trust Platform workflows. Prompt **wording** lives here as
Markdown so it can be edited, reviewed, and versioned independently of the application code that
assembles and sends the model call.

## Convention

- **One `.md` file per model-call system prompt**, named by a stable identifier (the template id).
  Application code refers to prompts by that id — never by inlining the text.
- The file body is the raw system-prompt text. It may contain **`{variable}` placeholders** that the
  application fills at render time (e.g. `{target_schema}`, `{flag_schema}`, `{flag_names}`). Only
  these declared variables are substituted; any other braces (e.g. the JSON-shape examples) are left
  untouched.
- Dynamic per-request state (the current field/flag values collected so far) is **not** part of the
  template — the application appends it after rendering. Templates hold reusable wording only.

## Who loads these

`ai-system-registry/backend/app/llm/templates.py` resolves this directory, loads a template by id,
and renders it. `app/llm/prompts.py` calls `render_template("<id>", <var>=...)` from each `build_*`
message builder. A missing template file or a missing required variable raises
`PromptTemplateError` with an actionable message.

The directory is resolved at runtime by walking up from the loader module to find `context/prompts/`,
or from the `PROMPTS_DIR` env var if set. The Docker image bakes this directory in at
`/app/context/prompts` (see `ai-system-registry/backend/Dockerfile`).

## Templates

| Template id | Workflow | Variable |
|---|---|---|
| `owner_turn` | Owner intake conversation turn | `target_schema` |
| `owner_doc_extract` | Owner document extraction | `target_schema` |
| `infer_flags` | Completion-time classifier-flag inference | `flag_names` |
| `engineer_turn` | Engineer intake conversation turn | `target_schema` |
| `engineer_doc_extract` | Engineer document extraction | `target_schema` |
| `questionnaire_business_turn` | Questionnaire — business section turn | `target_schema` |
| `questionnaire_technical_turn` | Questionnaire — technical section turn | `flag_schema` |
| `questionnaire_business_doc_extract` | Questionnaire — business doc extraction | `target_schema` |
| `questionnaire_technical_doc_extract` | Questionnaire — technical doc extraction | `flag_schema` |
| `classify_questionnaire` | AI-mode authoritative classification | `flag_names` |
| `json_repair_system` | JSON auto-repair retry — system prompt | — |
| `json_repair_user` | JSON auto-repair retry — user prompt | `malformed_response` |

## Editing & revisions

Change wording by editing the `.md` file — no code change is required when workflow behavior stays
the same. Templates are versioned via git: the loader logs `prompt.rendered` with the `template_id`
and `template_path` on every model call, so a demonstrated call maps to an exact file. Review the
change between two revisions with:

```bash
git log --oneline context/prompts/<template_id>.md
git diff <rev1> <rev2> -- context/prompts/<template_id>.md
```
