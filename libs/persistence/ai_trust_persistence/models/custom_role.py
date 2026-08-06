from sqlalchemy import Column, DateTime, String, Text, func
from ai_trust_persistence.database import Base


class CustomRole(Base):
    __tablename__ = "custom_roles"

    id = Column(String(64), primary_key=True)
    name = Column(String(128), nullable=False, unique=True)
    description = Column(Text(), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
