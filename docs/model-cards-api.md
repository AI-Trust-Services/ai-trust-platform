# Model Cards API (ai-system-registry)

> Moved out of the root [CLAUDE.md](../CLAUDE.md) to keep it under the 40k-char limit.

**Model Cards** (`routers/model_cards.py`, IDs prefixed `MDL-`) — standalone model documentation objects, linked N:M to AI systems via `ai_system_model_cards` join table (with an optional `role` string).
- `GET /model-cards` — flat list (no children loaded; `metrics`/`sources`/`datasets` always `[]`). `?limit=50&offset=0` (max 200).
- `POST /model-cards` — creates a card; requires `name`. Returns full tree.
- `GET /model-cards/{id}` — full nested tree (metrics, sources, datasets with preparations/measurements/feature_stores).
- `PATCH /model-cards/{id}` — partial update of scalar fields via `model_fields_set`; empty body is a valid no-op (200).
- `DELETE /model-cards/{id}` — returns the deleted card.
- `POST /model-cards/{id}/metrics` (IDs `MCM-`) · `DELETE /model-cards/{id}/metrics/{mid}` — add/remove a metric row. DELETE filters by both `metric_id` AND `card_id` — wrong-card deletes return 404.
- `POST /model-cards/{id}/sources` (IDs `MCS-`) · `DELETE /model-cards/{id}/sources/{sid}` — same pattern.
- `POST /model-cards/{id}/datasets` (IDs `MCD-`) — creates dataset with nested `preparations` (ordered, IDs `MCP-`), `measurements` (`MCE-`), `feature_stores` (`MCF-`) + groups (`MCG-`). Returns the new dataset (not the full card).
- `PATCH /model-cards/{id}/datasets/{did}` — scalar-only patch; children (preparations etc.) are untouched. Returns the updated dataset.
- `PUT /model-cards/{id}/datasets/{did}` — **full replace**: deletes all children, re-inserts from body. Returns **204 No Content** (no body).
- `DELETE /model-cards/{id}/datasets/{did}` — returns `{"status":"deleted","id":...}`. Wrong-card deletes return 404.
- `GET /model-cards/{id}/systems` — AI systems that link to this card (`ModelSystemResponse`: system scalars + `role`).
- `GET /systems/{id}/models` · `POST /systems/{id}/models` · `DELETE /systems/{id}/models/{card_id}` — list/link/unlink model cards on a system. POST is an upsert (updates `role` on repeat). DELETE returns `{"status":"unlinked","system_id":...,"model_card_id":...}`.
- **Schemas** — `ModelCardResponse` (flat for list, nested for single GET), `SystemModelResponse` (extends `ModelCardResponse` + `role`), `ModelSystemResponse` (system scalars + `role: str | None = None`; `role` has a default because it comes from the join table, not the system row).
