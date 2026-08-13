from __future__ import annotations

from sqlalchemy import String
from sqlalchemy.orm import Mapped, mapped_column


class TenantMixin:
    """Adds the multi-tenancy discriminator column to a model.

    The column is nullable: a NULL `tenant_id` marks a shared/catalog row that is
    visible to every tenant (the row-level-security policy in migration 0009 is
    ``tenant_id = current_setting('app.current_tenant', true) OR tenant_id IS NULL``).

    Application code never has to set `tenant_id` on INSERT: migration 0009 gives the
    column a server-side DEFAULT of ``current_setting('app.current_tenant', true)`` and
    `libs/tenancy` sets `app.current_tenant` per request. In single-tenant mode the
    setting is unset, so the default resolves to NULL and behavior is unchanged.
    """

    tenant_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
