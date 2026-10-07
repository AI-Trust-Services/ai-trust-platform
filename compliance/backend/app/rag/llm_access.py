"""LLM provider wiring for the EU AI Act RAG.

Builds a configured PageIndexClient for the platform's selected provider.
Uses the same LLM_PROVIDER / env vars as ai-system-registry — no new config needed.

  stub     → raises NotImplementedError (PageIndex requires a real model endpoint)
  ollama   → OpenAI-compatible local endpoint (LLM_BASE_URL / LLM_API_KEY / LLM_MODEL)
  external → OAuth2 + Anthropic /invoke via a local shim (app.rag.proxy);
             same wire as ai-system-registry's external provider

Wiring seam: set LLM_PROVIDER + the AI_* / LLM_* env vars, then call query.ask().
"""

from __future__ import annotations

import os

from . import config


def _check_external() -> None:
    missing = [
        n
        for n, v in {
            "AI_CLIENT_ID": config.AI_CLIENT_ID,
            "AI_CLIENT_SECRET": config.AI_CLIENT_SECRET,
            "AI_AUTH_URL": config.AI_AUTH_URL,
            "AI_API_URL": config.AI_API_URL,
            "AI_DEPLOYMENT_ID": config.AI_DEPLOYMENT_ID,
        }.items()
        if not v
    ]
    if missing:
        raise RuntimeError(
            f"LLM_PROVIDER=external requires these to be set: {', '.join(missing)}"
        )


def make_client(storage_path: str):
    """Return a PageIndexClient configured for the current provider."""
    from pageindex import PageIndexClient

    provider = config.LLM_PROVIDER

    if provider == "stub":
        raise NotImplementedError(
            "LLM_PROVIDER=stub is not supported for the RAG — use ollama or external."
        )

    if provider == "external":
        _check_external()
        from app.rag import proxy

        base_url = proxy.start()
        model = f"openai/{config.LLM_MODEL}"
        backend = {"api_key": "rag-proxy", "base_url": base_url}
        return PageIndexClient(
            index_model=model,
            storage_path=storage_path,
            index_backend=backend,
            chat_model=model,
            chat_backend=backend,
        )

    # ollama or any OpenAI-compatible endpoint
    os.environ["OPENAI_API_KEY"] = config.LLM_API_KEY
    os.environ["OPENAI_BASE_URL"] = config.LLM_BASE_URL
    return PageIndexClient(
        index={"model": config.LLM_MODEL, "storage_path": storage_path},
        chat=config.LLM_MODEL,
    )


def summary() -> str:
    return f"provider={config.LLM_PROVIDER} model={config.LLM_MODEL}"
