from __future__ import annotations

import os
import sys
from pathlib import Path

from pydantic import BaseModel

from risk_management.models import LLMProvider

if sys.version_info >= (3, 11):
    import tomllib
else:
    try:
        import tomli as tomllib
    except ImportError:
        tomllib = None  # type: ignore


_BASE_DIR = Path(__file__).parent.parent


def _env(key: str, default: str) -> str:
    return os.environ.get(f"AITRUST_{key}", default)


def _env_bool(key: str, default: bool) -> bool:
    val = os.environ.get(f"AITRUST_{key}")
    if val is None:
        return default
    return val.lower() in ("1", "true", "yes")


class AppConfig(BaseModel):
    llm_enabled: bool = False
    llm_provider: LLMProvider = LLMProvider.OLLAMA
    llm_base_url: str = "http://localhost:11434"
    llm_model: str = "llama3.2"
    llm_temperature: float = 0.2
    llm_timeout_seconds: int = 60

    risk_atlas_nexus_enabled: bool = False

    risk_taxonomy_path: str = str(_BASE_DIR / "data" / "risk_taxonomy.json")
    mitigation_library_path: str = str(_BASE_DIR / "data" / "mitigation_library.json")
    demo_dir: str = str(_BASE_DIR / "demo")

    output_dir: str = str(_BASE_DIR / "output")


def load_config(config_path: str | None = None) -> AppConfig:
    """Load config: defaults → config.toml → env vars (AITRUST_ prefix)."""
    file_data: dict = {}

    toml_path = Path(config_path) if config_path else _BASE_DIR / "config.toml"
    if toml_path.exists() and tomllib is not None:
        with open(toml_path, "rb") as f:
            file_data = tomllib.load(f).get("aitrust", {})

    return AppConfig(
        llm_enabled=_env_bool("LLM_ENABLED", file_data.get("llm_enabled", False)),
        llm_provider=LLMProvider(_env("LLM_PROVIDER", file_data.get("llm_provider", LLMProvider.OLLAMA.value))),
        llm_base_url=_env("LLM_BASE_URL", file_data.get("llm_base_url", "http://localhost:11434")),
        llm_model=_env("LLM_MODEL", file_data.get("llm_model", "llama3.2")),
        llm_temperature=float(_env("LLM_TEMPERATURE", str(file_data.get("llm_temperature", 0.2)))),
        llm_timeout_seconds=int(_env("LLM_TIMEOUT", str(file_data.get("llm_timeout_seconds", 60)))),
        risk_atlas_nexus_enabled=_env_bool(
            "RISK_ATLAS_NEXUS_ENABLED", file_data.get("risk_atlas_nexus_enabled", False)
        ),
        risk_taxonomy_path=_env(
            "RISK_TAXONOMY_PATH",
            file_data.get("risk_taxonomy_path", str(_BASE_DIR / "data" / "risk_taxonomy.json")),
        ),
        mitigation_library_path=_env(
            "MITIGATION_LIBRARY_PATH",
            file_data.get("mitigation_library_path", str(_BASE_DIR / "data" / "mitigation_library.json")),
        ),
        demo_dir=_env("DEMO_DIR", file_data.get("demo_dir", str(_BASE_DIR / "demo"))),
        output_dir=_env("OUTPUT_DIR", file_data.get("output_dir", str(_BASE_DIR / "output"))),
    )
