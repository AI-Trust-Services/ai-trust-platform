"""RAG module config — reads the platform's existing env vars, no new ones required.

RAG_DATA_DIR is required (fail-fast, per platform convention). In k8s it points
at a PVC mount shared by the rag-sync CronJob (writer) and the compliance
backend (reader); locally set it in .env to any writable path.
"""

from __future__ import annotations

import os
from pathlib import Path

DATA_DIR = Path(os.environ["RAG_DATA_DIR"])
INDEX_DIR = DATA_DIR / "index"
PDF_PATH = DATA_DIR / "eu_ai_act.pdf"
CURRENT_POINTER = INDEX_DIR / "current"

# Re-use the registry's LLM env vars — same provider, same credentials.
LLM_PROVIDER = os.environ.get("LLM_PROVIDER", "stub").lower()
LLM_MODEL = os.environ.get("LLM_MODEL", "llama3.2")

# ollama / OpenAI-compatible
LLM_BASE_URL = os.environ.get("LLM_BASE_URL", "http://ollama:11434/v1")
LLM_API_KEY = os.environ.get("LLM_API_KEY", "ollama")

# external provider (OAuth2 + Anthropic /invoke)
AI_CLIENT_ID = os.environ.get("AI_CLIENT_ID", "")
AI_CLIENT_SECRET = os.environ.get("AI_CLIENT_SECRET", "")
AI_AUTH_URL = os.environ.get("AI_AUTH_URL", "")
AI_API_URL = os.environ.get("AI_API_URL", "").rstrip("/")
AI_RESOURCE_GROUP = os.environ.get("AI_RESOURCE_GROUP", "default")
AI_DEPLOYMENT_ID = os.environ.get("AI_DEPLOYMENT_ID", "")

# CELEX identifier for the version to download. Defaults to the 2026-07-27
# consolidated text (includes all amendments up to that date).
# Set to "32024R1689" for the original 2024 OJ publication.
EUR_LEX_CELEX = os.environ.get("EUR_LEX_CELEX", "02024R1689-20260727")

# Override the resolved download URL entirely (e.g. to point at a local file://
# or a pre-signed URL). When unset, ingest.py resolves it from EUR_LEX_CELEX
# via the Cellar SPARQL endpoint.
EUR_LEX_PDF_URL = os.environ.get("EUR_LEX_PDF_URL", "")
