import os

from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

DATABASE_URL = os.environ["DATABASE_URL"]

engine = create_async_engine(
    DATABASE_URL,
    echo=False,
    pool_size=5,
    max_overflow=10,
    pool_pre_ping=True,
)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False)

# Multi-tenancy: install the per-tenant scoping hook so every transaction on this
# engine is routed to the requesting tenant's Postgres schema (search_path =
# tenant_<org>) under its per-tenant role. Isolation is physical — one schema and one
# scoped role per tenant. No-op when TENANCY_MODE=single (default) or when libs/tenancy
# isn't installed — keeps the single-tenant / library-only paths working unchanged.
try:
    from ai_trust_tenancy import install_tenant_scoping

    install_tenant_scoping(engine)
except ImportError:  # libs/tenancy not installed in this context
    pass


class Base(DeclarativeBase):
    pass
