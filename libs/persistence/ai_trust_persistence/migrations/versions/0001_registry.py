"""Registry tables: ai_systems, model_cards (+ seed 12 known model cards)

Revision ID: 0001
Revises:
Create Date: 2026-07-16
"""
import sqlalchemy as sa
from alembic import op

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None

_model_cards = sa.table(
    "model_cards",
    sa.column("id", sa.String),
    sa.column("name", sa.String),
    sa.column("provider", sa.String),
    sa.column("version", sa.String),
    sa.column("model_type", sa.String),
    sa.column("description", sa.Text),
    sa.column("open_weights", sa.Boolean),
    sa.column("inference_url", sa.String),
)

_SEED_MODEL_CARDS = [
    ("MDL-GPT4O",  "GPT-4o",                    "openai",     "2024-08",  "llm",       "OpenAI flagship multimodal model",                              False, "https://api.openai.com/v1"),
    ("MDL-GPT4T",  "GPT-4 Turbo",               "openai",     "2024-04",  "llm",       "OpenAI GPT-4 Turbo with 128k context",                         False, "https://api.openai.com/v1"),
    ("MDL-CL35S",  "Claude 3.5 Sonnet",          "anthropic",  "20241022", "llm",       "Anthropic Claude 3.5 Sonnet — fast and intelligent",            False, "https://api.anthropic.com/v1"),
    ("MDL-CL3OP",  "Claude 3 Opus",              "anthropic",  "20240229", "llm",       "Anthropic Claude 3 Opus — most capable",                       False, "https://api.anthropic.com/v1"),
    ("MDL-GEMP",   "Gemini 1.5 Pro",             "google",     "001",      "llm",       "Google Gemini 1.5 Pro with 1M context window",                 False, "https://generativelanguage.googleapis.com/v1"),
    ("MDL-MISTL",  "Mistral Large",              "mistral",    "2402",     "llm",       "Mistral AI large model — strong reasoning",                     False, "https://api.mistral.ai/v1"),
    ("MDL-MISTM",  "Mistral 7B",                 "mistral",    "0.3",      "llm",       "Mistral 7B open-weights instruction model",                     True,  ""),
    ("MDL-LLA3",   "Llama 3 70B",                "meta",       "3.0",      "llm",       "Meta Llama 3 70B open-weights model",                           True,  ""),
    ("MDL-LLA3S",  "Llama 3 8B",                 "meta",       "3.0",      "llm",       "Meta Llama 3 8B open-weights model",                            True,  ""),
    ("MDL-MIXL",   "Mixtral 8x7B",               "mistral",    "0.1",      "llm",       "Mistral Mixtral MoE open-weights model",                        True,  ""),
    ("MDL-EMBD",   "text-embedding-3-large",     "openai",     "1",        "embedding", "OpenAI large text embedding model",                             False, "https://api.openai.com/v1"),
    ("MDL-COHR",   "Command R+",                 "cohere",     "2024-04",  "llm",       "Cohere Command R+ for enterprise RAG",                          False, "https://api.cohere.com/v1"),
]


def upgrade() -> None:
    op.create_table(
        "model_cards",
        sa.Column("id", sa.String(20), primary_key=True),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("provider", sa.String(100), nullable=False),
        sa.Column("version", sa.String(50), nullable=False, server_default=""),
        sa.Column("model_type", sa.String(50), nullable=False, server_default="llm"),
        sa.Column("description", sa.Text, nullable=False, server_default=""),
        sa.Column("open_weights", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("inference_url", sa.String(500), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_model_cards_name", "model_cards", ["name"])
    op.create_index("ix_model_cards_provider", "model_cards", ["provider"])

    op.create_table(
        "ai_systems",
        sa.Column("id", sa.String(20), primary_key=True),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("version", sa.String(50), nullable=False, server_default="1.0.0"),
        sa.Column("provider", sa.String(200), nullable=False, server_default=""),
        sa.Column("org_name", sa.String(200), nullable=False, server_default=""),
        sa.Column("org_role", sa.String(30), nullable=False, server_default="provider"),
        sa.Column("description", sa.Text, nullable=False, server_default=""),
        sa.Column("intended_purpose", sa.Text, nullable=False, server_default=""),
        sa.Column("system_type", sa.String(30), nullable=False, server_default="application"),
        sa.Column("autonomy_level", sa.String(50), nullable=False, server_default="decision_support"),
        sa.Column("application_url", sa.String(500), nullable=False, server_default=""),
        sa.Column("provider_country", sa.String(5), nullable=False, server_default="DE"),
        sa.Column("tier", sa.String(30), nullable=False),
        sa.Column("basis", sa.Text, nullable=False, server_default=""),
        sa.Column("annex_iii_area", sa.Integer, nullable=True),
        sa.Column("lifecycle", sa.String(30), nullable=False, server_default="development"),
        sa.Column("compliance", sa.Float, nullable=False, server_default="0"),
        sa.Column("model_id", sa.String(20), sa.ForeignKey("model_cards.id", ondelete="SET NULL"), nullable=True),
        sa.Column("subliminal_manipulation", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("exploits_vulnerability", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("social_scoring_public", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("real_time_biometric_public", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("emotion_recognition_workplace", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("untargeted_facial_scraping", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("predictive_policing", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("biometric_categorisation_sensitive", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("is_biometric_identification", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("is_critical_infrastructure", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("is_education_related", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("is_employment_related", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("is_credit_scoring", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("is_public_service", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("is_law_enforcement", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("is_migration", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("is_judicial_admin", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("is_gpai", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("training_compute_flops", sa.Float, nullable=False, server_default="0"),
        sa.Column("is_chatbot", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("generates_synthetic_content", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_ai_systems_name", "ai_systems", ["name"])
    op.create_index("ix_ai_systems_tier", "ai_systems", ["tier"])
    op.create_index("ix_ai_systems_lifecycle", "ai_systems", ["lifecycle"])

    op.bulk_insert(_model_cards, [
        {
            "id": id_, "name": name, "provider": provider, "version": version,
            "model_type": model_type, "description": description,
            "open_weights": open_weights, "inference_url": inference_url,
        }
        for id_, name, provider, version, model_type, description, open_weights, inference_url in _SEED_MODEL_CARDS
    ])


def downgrade() -> None:
    op.drop_index("ix_ai_systems_lifecycle", "ai_systems")
    op.drop_index("ix_ai_systems_tier", "ai_systems")
    op.drop_index("ix_ai_systems_name", "ai_systems")
    op.drop_table("ai_systems")
    op.drop_index("ix_model_cards_provider", "model_cards")
    op.drop_index("ix_model_cards_name", "model_cards")
    op.drop_table("model_cards")
