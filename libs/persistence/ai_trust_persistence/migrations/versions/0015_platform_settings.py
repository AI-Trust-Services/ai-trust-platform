"""Platform settings table.

Revision ID: 0015
Revises: 0014
Create Date: 2026-08-27
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "0015"
down_revision = "0014"
branch_labels = None
depends_on = None


# Default settings to seed
DEFAULT_SETTINGS = [
    # Mail settings
    {
        "key": "smtp.host",
        "category": "mail",
        "label": "SMTP Host",
        "description": "SMTP server hostname",
        "value_type": "string",
        "is_secret": False,
        "value": None,
    },
    {
        "key": "smtp.port",
        "category": "mail",
        "label": "SMTP Port",
        "description": "SMTP server port (typically 587 for TLS, 465 for SSL)",
        "value_type": "number",
        "is_secret": False,
        "value": 587,
    },
    {
        "key": "smtp.user",
        "category": "mail",
        "label": "SMTP Username",
        "description": "Username for SMTP authentication",
        "value_type": "string",
        "is_secret": False,
        "value": None,
    },
    {
        "key": "smtp.password",
        "category": "mail",
        "label": "SMTP Password",
        "description": "Password for SMTP authentication",
        "value_type": "secret",
        "is_secret": True,
        "value": None,
    },
    {
        "key": "smtp.from",
        "category": "mail",
        "label": "From Address",
        "description": "Email address to send from",
        "value_type": "string",
        "is_secret": False,
        "value": None,
    },
    {
        "key": "smtp.from_name",
        "category": "mail",
        "label": "From Name",
        "description": "Display name for sent emails",
        "value_type": "string",
        "is_secret": False,
        "value": "AI Trust Platform",
    },
    {
        "key": "smtp.ssl",
        "category": "mail",
        "label": "Use SSL",
        "description": "Connect using SSL (port 465)",
        "value_type": "boolean",
        "is_secret": False,
        "value": False,
    },
    {
        "key": "smtp.starttls",
        "category": "mail",
        "label": "Use STARTTLS",
        "description": "Upgrade connection to TLS (port 587)",
        "value_type": "boolean",
        "is_secret": False,
        "value": True,
    },
    # AI Provider settings
    {
        "key": "llm.provider",
        "category": "ai",
        "label": "LLM Provider",
        "description": "AI provider type: stub (testing), ollama (local), or external (production)",
        "value_type": "string",
        "is_secret": False,
        "value": "stub",
    },
    {
        "key": "llm.base_url",
        "category": "ai",
        "label": "LLM Base URL",
        "description": "Base URL for OpenAI-compatible API (ollama provider)",
        "value_type": "string",
        "is_secret": False,
        "value": "http://ollama:11434/v1",
    },
    {
        "key": "llm.api_key",
        "category": "ai",
        "label": "LLM API Key",
        "description": "API key for LLM provider",
        "value_type": "secret",
        "is_secret": True,
        "value": None,
    },
    {
        "key": "llm.model",
        "category": "ai",
        "label": "LLM Model",
        "description": "Model name for text generation",
        "value_type": "string",
        "is_secret": False,
        "value": "llama3.2",
    },
    {
        "key": "llm.vision_model",
        "category": "ai",
        "label": "Vision Model",
        "description": "Model name for image understanding",
        "value_type": "string",
        "is_secret": False,
        "value": "llama3.2-vision",
    },
    {
        "key": "ai.client_id",
        "category": "ai",
        "label": "OAuth Client ID",
        "description": "Client ID for OAuth2 authentication (external provider)",
        "value_type": "string",
        "is_secret": False,
        "value": None,
    },
    {
        "key": "ai.client_secret",
        "category": "ai",
        "label": "OAuth Client Secret",
        "description": "Client secret for OAuth2 authentication (external provider)",
        "value_type": "secret",
        "is_secret": True,
        "value": None,
    },
    {
        "key": "ai.auth_url",
        "category": "ai",
        "label": "OAuth Auth URL",
        "description": "OAuth2 token endpoint URL (external provider)",
        "value_type": "string",
        "is_secret": False,
        "value": None,
    },
    {
        "key": "ai.api_url",
        "category": "ai",
        "label": "AI API URL",
        "description": "API endpoint URL (external provider)",
        "value_type": "string",
        "is_secret": False,
        "value": None,
    },
    {
        "key": "ai.deployment_id",
        "category": "ai",
        "label": "Deployment ID",
        "description": "Deployment/model ID (external provider)",
        "value_type": "string",
        "is_secret": False,
        "value": None,
    },
    {
        "key": "ai.resource_group",
        "category": "ai",
        "label": "Resource Group",
        "description": "Resource group for AI service (external provider)",
        "value_type": "string",
        "is_secret": False,
        "value": None,
    },
    # General platform settings
    {
        "key": "platform.name",
        "category": "general",
        "label": "Platform Name",
        "description": "Name displayed in the platform header",
        "value_type": "string",
        "is_secret": False,
        "value": "AI Trust Platform",
    },
    {
        "key": "platform.support_email",
        "category": "general",
        "label": "Support Email",
        "description": "Email address for platform support inquiries",
        "value_type": "string",
        "is_secret": False,
        "value": None,
    },
]


def upgrade() -> None:
    # Create platform_settings table
    op.create_table(
        "platform_settings",
        sa.Column("key", sa.String(100), primary_key=True),
        sa.Column("value", postgresql.JSONB, nullable=True),
        sa.Column("category", sa.String(50), nullable=False, index=True),
        sa.Column("label", sa.String(100), server_default=""),
        sa.Column("description", sa.Text, server_default=""),
        sa.Column("value_type", sa.String(20), server_default="string"),
        sa.Column("is_secret", sa.Boolean, server_default="false"),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
        ),
        sa.Column("updated_by", sa.String(200), nullable=True),
    )

    # Seed default settings using bulk insert
    import json

    conn = op.get_bind()
    for setting in DEFAULT_SETTINGS:
        # Convert Python value to JSON string for JSONB
        value_json = json.dumps(setting["value"]) if setting["value"] is not None else None
        conn.execute(
            sa.text(
                """
                INSERT INTO platform_settings (key, value, category, label, description, value_type, is_secret)
                VALUES (:key, CAST(:value AS jsonb), :category, :label, :description, :value_type, :is_secret)
                ON CONFLICT (key) DO NOTHING
                """
            ),
            {
                "key": setting["key"],
                "value": value_json,
                "category": setting["category"],
                "label": setting["label"],
                "description": setting["description"],
                "value_type": setting["value_type"],
                "is_secret": setting["is_secret"],
            },
        )


def downgrade() -> None:
    op.drop_table("platform_settings")
