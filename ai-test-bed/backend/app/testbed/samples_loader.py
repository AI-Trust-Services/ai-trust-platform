"""Sample fixture loader for the AI Test Bed.

Loads YAML fixture files from the ``samples/`` sub-directory and exposes them
as a dict keyed by sample id. The fixtures are read once at import time and
cached in-memory; no DB or network access.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml

_SAMPLES_DIR = Path(__file__).parent / "samples"


def _load_all() -> dict[str, dict[str, Any]]:
    result: dict[str, dict[str, Any]] = {}
    for path in sorted(_SAMPLES_DIR.glob("*.yaml")):
        data = yaml.safe_load(path.read_text(encoding="utf-8"))
        if isinstance(data, dict) and "id" in data:
            result[data["id"]] = data
    return result


SAMPLES: dict[str, dict[str, Any]] = _load_all()


def list_samples() -> list[dict[str, Any]]:
    """Return a list of sample summaries (id, name, description, expected_tier)."""
    return [
        {
            "id": s["id"],
            "name": s.get("name", s["id"]),
            "description": str(s.get("description", "")).strip(),
            "expected_tier": s.get("expected_tier"),
        }
        for s in SAMPLES.values()
    ]


def get_sample(sample_id: str) -> dict[str, Any] | None:
    """Return the full sample fixture or None if not found."""
    return SAMPLES.get(sample_id)
