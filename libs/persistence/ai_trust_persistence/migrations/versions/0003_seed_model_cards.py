"""seed known LLM model cards

Revision ID: 0003
Revises: 0002
Create Date: 2026-06-04
"""
from alembic import op
from sqlalchemy.sql import table, column
from sqlalchemy import String, Boolean, Text
import datetime

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None

model_cards = table(
    "model_cards",
    column("id", String),
    column("name", String),
    column("provider", String),
    column("version", String),
    column("model_type", String),
    column("description", Text),
    column("open_weights", Boolean),
    column("inference_url", String),
)

_SEED = [
    ("MDL-GPT4O", "GPT-4o", "openai", "2024-08", "llm", "OpenAI flagship multimodal model", False, "https://api.openai.com/v1"),
    ("MDL-GPT4T", "GPT-4 Turbo", "openai", "2024-04", "llm", "OpenAI GPT-4 Turbo with 128k context", False, "https://api.openai.com/v1"),
    ("MDL-CL35S", "Claude 3.5 Sonnet", "anthropic", "20241022", "llm", "Anthropic Claude 3.5 Sonnet — fast and intelligent", False, "https://api.anthropic.com/v1"),
    ("MDL-CL3OP", "Claude 3 Opus", "anthropic", "20240229", "llm", "Anthropic Claude 3 Opus — most capable", False, "https://api.anthropic.com/v1"),
    ("MDL-GEMP", "Gemini 1.5 Pro", "google", "001", "llm", "Google Gemini 1.5 Pro with 1M context window", False, "https://generativelanguage.googleapis.com/v1"),
    ("MDL-MISTL", "Mistral Large", "mistral", "2402", "llm", "Mistral AI large model — strong reasoning", False, "https://api.mistral.ai/v1"),
    ("MDL-MISTM", "Mistral 7B", "mistral", "0.3", "llm", "Mistral 7B open-weights instruction model", True, ""),
    ("MDL-LLA3", "Llama 3 70B", "meta", "3.0", "llm", "Meta Llama 3 70B open-weights model", True, ""),
    ("MDL-LLA3S", "Llama 3 8B", "meta", "3.0", "llm", "Meta Llama 3 8B open-weights model", True, ""),
    ("MDL-MIXL", "Mixtral 8x7B", "mistral", "0.1", "llm", "Mistral Mixtral MoE open-weights model", True, ""),
    ("MDL-EMBD", "text-embedding-3-large", "openai", "1", "embedding", "OpenAI large text embedding model", False, "https://api.openai.com/v1"),
    ("MDL-COHR", "Command R+", "cohere", "2024-04", "llm", "Cohere Command R+ for enterprise RAG", False, "https://api.cohere.com/v1"),
]


def upgrade() -> None:
    op.bulk_insert(model_cards, [
        {
            "id": id_, "name": name, "provider": provider, "version": version,
            "model_type": model_type, "description": description,
            "open_weights": open_weights, "inference_url": inference_url,
        }
        for id_, name, provider, version, model_type, description, open_weights, inference_url in _SEED
    ])


def downgrade() -> None:
    op.execute("DELETE FROM model_cards WHERE id LIKE 'MDL-%'")
