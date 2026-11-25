"""Shared fixtures for registry unit tests.

Unit tests run with no database. The LLM client resolves its provider per call
(``resolve_runtime_config``), which opens a DB session to read the BYO
``llm_provider_config`` row. To keep unit tests DB-free, pin the resolved
provider to offline stub mode for every unit test; tests that mock ``chat``
directly are unaffected.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest


@pytest.fixture(autouse=True)
def _stub_llm_provider():
    from app.llm.client import RuntimeConfig

    stub_cfg = RuntimeConfig(
        base_url="stub", api_token="", model="m", source="thalamus"
    )
    with patch(
        "app.llm.client.resolve_runtime_config",
        new_callable=AsyncMock,
        return_value=stub_cfg,
    ):
        yield
