"""Create branding key-value table and migrate data from platform_settings.

Revision ID: 0031
Revises: 0030
Create Date: 2026-09-23
"""
from alembic import op
import sqlalchemy as sa


revision = "0032"
down_revision = "0031"
branch_labels = None
depends_on = None


# All branding fields that need to be migrated from platform_settings columns to branding rows
BRANDING_FIELDS = [
    # Logos
    "logo_horizontal_light",
    "logo_horizontal_dark",
    "logo_icon",
    "favicon",
    # Brand colors (light mode)
    "primary_color",
    "secondary_color",
    "accent_color",
    "warning_color",
    # Brand colors (dark mode)
    "primary_color_dark",
    "secondary_color_dark",
    "accent_color_dark",
    "warning_color_dark",
    # Shell colors (light mode)
    "sidebar_bg",
    "sidebar_text",
    "header_bg",
    "header_text",
    # Shell colors (dark mode)
    "sidebar_bg_dark",
    "sidebar_text_dark",
    "header_bg_dark",
    "header_text_dark",
    # UI element colors (light mode)
    "button_bg",
    "button_text",
    "table_header_bg",
    "table_border",
    "mfe_bg",
    # UI element colors (dark mode)
    "button_bg_dark",
    "button_text_dark",
    "table_header_bg_dark",
    "table_border_dark",
    "mfe_bg_dark",
]


def upgrade() -> None:
    # Create the branding key-value table
    op.create_table(
        "branding",
        sa.Column("key", sa.String(100), primary_key=True),
        sa.Column("published", sa.Text, nullable=True),
        sa.Column("draft", sa.Text, nullable=True),
    )

    # Migrate existing data from platform_settings to branding table
    # Using raw SQL for the data migration since we need to read from existing columns
    conn = op.get_bind()

    # Check if platform_settings has data to migrate
    result = conn.execute(sa.text("SELECT COUNT(*) FROM platform_settings WHERE id = 1"))
    count = result.scalar()
    if count == 0:
        return  # No data to migrate

    # Migrate each branding field
    for field in BRANDING_FIELDS:
        # Read both published and draft values
        result = conn.execute(sa.text(f"""
            SELECT {field}, {field}_draft FROM platform_settings WHERE id = 1
        """))
        row = result.fetchone()
        if row:
            published_val, draft_val = row
            # Only insert if at least one value is not null
            if published_val is not None or draft_val is not None:
                conn.execute(sa.text("""
                    INSERT INTO branding (key, published, draft)
                    VALUES (:key, :published, :draft)
                """), {"key": field, "published": published_val, "draft": draft_val})

    # Migrate advanced_colors (JSONB → JSON string)
    result = conn.execute(sa.text("""
        SELECT advanced_colors, advanced_colors_draft FROM platform_settings WHERE id = 1
    """))
    row = result.fetchone()
    if row:
        adv_pub, adv_draft = row
        if adv_pub is not None or adv_draft is not None:
            import json
            conn.execute(sa.text("""
                INSERT INTO branding (key, published, draft)
                VALUES (:key, :published, :draft)
            """), {
                "key": "advanced_colors",
                "published": json.dumps(adv_pub) if adv_pub else None,
                "draft": json.dumps(adv_draft) if adv_draft else None,
            })

    # Migrate publish metadata as special keys
    result = conn.execute(sa.text("""
        SELECT branding_published_at, branding_published_by FROM platform_settings WHERE id = 1
    """))
    row = result.fetchone()
    if row:
        pub_at, pub_by = row
        if pub_at is not None:
            conn.execute(sa.text("""
                INSERT INTO branding (key, published, draft)
                VALUES (:key, :published, NULL)
            """), {"key": "_published_at", "published": pub_at.isoformat() if pub_at else None})
        if pub_by is not None:
            conn.execute(sa.text("""
                INSERT INTO branding (key, published, draft)
                VALUES (:key, :published, NULL)
            """), {"key": "_published_by", "published": pub_by})


def downgrade() -> None:
    # Drop the branding table (data loss — the platform_settings columns still exist as fallback)
    op.drop_table("branding")
