"""Add shell text colors and MFE background color to branding.

Revision ID: 0031
Revises: 0030
Create Date: 2026-09-22
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0031"
down_revision: str | None = "0030"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Shell text colors (light mode)
    op.add_column("platform_settings", sa.Column("sidebar_text", sa.String(20), nullable=True))
    op.add_column("platform_settings", sa.Column("header_text", sa.String(20), nullable=True))
    # Shell text colors (dark mode)
    op.add_column("platform_settings", sa.Column("sidebar_text_dark", sa.String(20), nullable=True))
    op.add_column("platform_settings", sa.Column("header_text_dark", sa.String(20), nullable=True))
    # MFE background color
    op.add_column("platform_settings", sa.Column("mfe_bg", sa.String(20), nullable=True))
    op.add_column("platform_settings", sa.Column("mfe_bg_dark", sa.String(20), nullable=True))
    # Draft variants
    op.add_column("platform_settings", sa.Column("sidebar_text_draft", sa.String(20), nullable=True))
    op.add_column("platform_settings", sa.Column("header_text_draft", sa.String(20), nullable=True))
    op.add_column("platform_settings", sa.Column("sidebar_text_dark_draft", sa.String(20), nullable=True))
    op.add_column("platform_settings", sa.Column("header_text_dark_draft", sa.String(20), nullable=True))
    op.add_column("platform_settings", sa.Column("mfe_bg_draft", sa.String(20), nullable=True))
    op.add_column("platform_settings", sa.Column("mfe_bg_dark_draft", sa.String(20), nullable=True))


def downgrade() -> None:
    op.drop_column("platform_settings", "mfe_bg_dark_draft")
    op.drop_column("platform_settings", "mfe_bg_draft")
    op.drop_column("platform_settings", "header_text_dark_draft")
    op.drop_column("platform_settings", "sidebar_text_dark_draft")
    op.drop_column("platform_settings", "header_text_draft")
    op.drop_column("platform_settings", "sidebar_text_draft")
    op.drop_column("platform_settings", "mfe_bg_dark")
    op.drop_column("platform_settings", "mfe_bg")
    op.drop_column("platform_settings", "header_text_dark")
    op.drop_column("platform_settings", "sidebar_text_dark")
    op.drop_column("platform_settings", "header_text")
    op.drop_column("platform_settings", "sidebar_text")
