import os
from pathlib import Path

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

_data_dir = Path(os.environ.get("COGNEE_DATA_PATH", "/app/.cognee_system"))
_data_dir.mkdir(parents=True, exist_ok=True)

_db_path = _data_dir / "cognee_eval.db"
_engine = create_async_engine(f"sqlite+aiosqlite:///{_db_path}", echo=False)

SessionLocal = async_sessionmaker(_engine, class_=AsyncSession, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


async def init_db() -> None:
    """Create all tables on startup. Safe to call repeatedly."""
    async with _engine.begin() as conn:
        from app.models import evaluation, feedback
        await conn.run_sync(Base.metadata.create_all)
