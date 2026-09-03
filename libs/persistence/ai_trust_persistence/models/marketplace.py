from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from ai_trust_persistence.database import Base


class MarketplaceService(Base):
    """A service added to the in-app Marketplace.

    ``source`` = "internal"  → we clone + run it on THIS cluster; opens same-window
                               (embedded, served same-origin via the marketplace proxy).
    ``source`` = "external"  → it runs elsewhere; we only store a URL; opens in a new tab.

    Phase 1 supports internal + ``kind="static"`` only (git-clone initContainer + nginx).
    ``kind="dockerfile"`` (Kaniko build) is Phase 2.
    """

    __tablename__ = "marketplace_services"

    id: Mapped[str] = mapped_column(String(20), primary_key=True)  # MKT-XXXXXXXX
    name: Mapped[str] = mapped_column(String(63), nullable=False, unique=True, index=True)  # k8s-safe
    label: Mapped[str] = mapped_column(String(200), nullable=False)
    git_url: Mapped[str] = mapped_column(Text, nullable=False)
    git_ref: Mapped[str] = mapped_column(String(200), nullable=False, default="main")
    kind: Mapped[str] = mapped_column(String(20), nullable=False, default="static")  # static|dockerfile
    source: Mapped[str] = mapped_column(String(20), nullable=False, default="internal")  # internal|external
    open_mode: Mapped[str] = mapped_column(String(20), nullable=False, default="same_window")  # same_window|new_tab
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default="pending", index=True
    )  # pending|deploying|running|failed
    # In-cluster Service name backing an internal service (e.g. "weather-svc"); or the
    # external URL for source="external".
    service_host: Mapped[str | None] = mapped_column(Text, nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )
