from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Optional

import httpx

from risk_management.config import AppConfig
from risk_management.models import LLMProvider
from pydantic import BaseModel


class LLMDisabledError(RuntimeError):
    pass


class LLMUnavailableError(RuntimeError):
    pass


class LLMResponse(BaseModel):
    content: str
    model: str
    provider: str
    prompt_tokens: Optional[int] = None
    completion_tokens: Optional[int] = None


class LLMClient(ABC):
    @abstractmethod
    def complete(self, system_prompt: str, user_prompt: str) -> LLMResponse: ...

    @abstractmethod
    def is_available(self) -> bool: ...


class NullLLMClient(LLMClient):
    """Used when LLM is disabled. All calls raise LLMDisabledError."""

    def complete(self, system_prompt: str, user_prompt: str) -> LLMResponse:
        raise LLMDisabledError(
            "LLM is disabled. Enable it in the UI or set AITRUST_LLM_ENABLED=true."
        )

    def is_available(self) -> bool:
        return False


class OllamaClient(LLMClient):
    """Calls Ollama's REST API via httpx (sync). No LangChain or openai SDK required."""

    def __init__(self, base_url: str, model: str, temperature: float, timeout: int):
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.temperature = temperature
        self.timeout = timeout

    def complete(self, system_prompt: str, user_prompt: str) -> LLMResponse:
        payload = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            "options": {"temperature": self.temperature},
            "stream": False,
        }
        try:
            response = httpx.post(
                f"{self.base_url}/api/chat",
                json=payload,
                timeout=self.timeout,
            )
            response.raise_for_status()
        except httpx.HTTPError as exc:
            raise LLMUnavailableError(f"Ollama request failed: {exc}") from exc

        data = response.json()
        content = data.get("message", {}).get("content", "")
        return LLMResponse(
            content=content,
            model=self.model,
            provider="ollama",
            prompt_tokens=data.get("prompt_eval_count"),
            completion_tokens=data.get("eval_count"),
        )

    def is_available(self) -> bool:
        try:
            response = httpx.get(f"{self.base_url}/api/tags", timeout=5)
            if response.status_code != 200:
                return False
            models = [m.get("name", "") for m in response.json().get("models", [])]
            # Accept model name with or without :latest tag
            base = self.model.split(":")[0]
            return any(m.split(":")[0] == base for m in models)
        except Exception:
            return False


class OpenAICompatibleClient(LLMClient):
    """Calls any OpenAI-compatible endpoint (OpenAI, LM Studio, vLLM, etc.)."""

    def __init__(self, base_url: str, model: str, temperature: float, timeout: int, api_key: str = ""):
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.temperature = temperature
        self.timeout = timeout
        self.api_key = api_key

    def complete(self, system_prompt: str, user_prompt: str) -> LLMResponse:
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"

        payload = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            "temperature": self.temperature,
        }
        try:
            response = httpx.post(
                f"{self.base_url}/v1/chat/completions",
                json=payload,
                headers=headers,
                timeout=self.timeout,
            )
            response.raise_for_status()
        except httpx.HTTPError as exc:
            raise LLMUnavailableError(f"OpenAI-compatible request failed: {exc}") from exc

        data = response.json()
        content = data["choices"][0]["message"]["content"]
        usage = data.get("usage", {})
        return LLMResponse(
            content=content,
            model=self.model,
            provider="openai_compatible",
            prompt_tokens=usage.get("prompt_tokens"),
            completion_tokens=usage.get("completion_tokens"),
        )

    def is_available(self) -> bool:
        try:
            headers = {}
            if self.api_key:
                headers["Authorization"] = f"Bearer {self.api_key}"
            response = httpx.get(f"{self.base_url}/v1/models", headers=headers, timeout=5)
            return response.status_code == 200
        except Exception:
            return False


def build_llm_client(config: AppConfig) -> LLMClient:
    if not config.llm_enabled or config.llm_provider == LLMProvider.NONE:
        return NullLLMClient()
    if config.llm_provider == LLMProvider.OLLAMA:
        return OllamaClient(
            base_url=config.llm_base_url,
            model=config.llm_model,
            temperature=config.llm_temperature,
            timeout=config.llm_timeout_seconds,
        )
    if config.llm_provider == LLMProvider.OPENAI_COMPATIBLE:
        import os
        return OpenAICompatibleClient(
            base_url=config.llm_base_url,
            model=config.llm_model,
            temperature=config.llm_temperature,
            timeout=config.llm_timeout_seconds,
            api_key=os.environ.get("AITRUST_LLM_API_KEY", ""),
        )
    return NullLLMClient()
