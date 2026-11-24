from datetime import datetime

from sqlalchemy import Boolean, DateTime, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from ai_trust_persistence.database import Base


class LLMProviderConfig(Base):
    """Bring-your-own-LLM provider configuration (issue #406).

    Single-row table (``id=1``), one row per Postgres schema — which means one
    per tenant in ``jwt`` mode and one global row in ``single`` mode, exactly
    like ``platform_settings``.

    Holds an OpenAI-compatible endpoint the tenant admin configures at runtime.
    When ``is_active`` is True the registry's LLM workflows resolve to this
    provider instead of the platform-default Thalamus env config; when False
    (or no row) they fall back to Thalamus. There is **no silent fallback**
    between providers on error — a failing active provider surfaces an error.

    The token is stored plaintext and **never returned** by the admin GET
    endpoint (only ``has_token: bool``), matching ``platform_settings.smtp_password``.
    """

    __tablename__ = "llm_provider_config"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)

    # OpenAI-compatible endpoint (e.g. https://host/v1). The three values the
    # AsyncOpenAI client needs: base_url, api_key (token), model id.
    base_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    model: Mapped[str | None] = mapped_column(String(200), nullable=True)
    api_token: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Activation gate. False (or no row) => use platform-default Thalamus.
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    # Last Test Connection probe outcome, surfaced in the UI so an admin can
    # see whether the saved config passed before activating.
    last_test_status: Mapped[str | None] = mapped_column(String(20), nullable=True)
    last_test_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    last_tested_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    updated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        server_default=func.now(),
        onupdate=func.now(),
    )
    updated_by: Mapped[str | None] = mapped_column(String(200), nullable=True)
