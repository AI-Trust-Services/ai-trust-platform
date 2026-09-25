"""Seed 12 known model cards for the redesigned model_cards schema.

Revision ID: 0026
Revises: 0025
Create Date: 2026-09-25
"""
import sqlalchemy as sa
from alembic import op

revision = "0026"
down_revision = "0025"
branch_labels = None
depends_on = None

_model_cards = sa.table(
    "model_cards",
    sa.column("id", sa.String),
    sa.column("name", sa.String),
    sa.column("version", sa.String),
    sa.column("base_model", sa.String),
    sa.column("task_type", sa.String),
    sa.column("license_name", sa.String),
    sa.column("tags", sa.JSON),
)

_SEEDS = [
    ("MDL-GPT4O",  "GPT-4o",                   "2024-08",  "gpt-4o",                                    "text-generation",   "proprietary",           ["llm"]),
    ("MDL-GPT4T",  "GPT-4 Turbo",              "2024-04",  "gpt-4-turbo",                               "text-generation",   "proprietary",           ["llm"]),
    ("MDL-CL35S",  "Claude 3.5 Sonnet",        "20241022", "claude-3-5-sonnet-20241022",                "text-generation",   "proprietary",           ["llm"]),
    ("MDL-CL3OP",  "Claude 3 Opus",            "20240229", "claude-3-opus-20240229",                    "text-generation",   "proprietary",           ["llm"]),
    ("MDL-GEMP",   "Gemini 1.5 Pro",           "001",      "gemini-1.5-pro",                            "text-generation",   "proprietary",           ["llm"]),
    ("MDL-MISTL",  "Mistral Large",            "2402",     "mistral-large-2402",                        "text-generation",   "proprietary",           ["llm"]),
    ("MDL-MISTM",  "Mistral 7B",               "0.3",      "mistralai/Mistral-7B-Instruct-v0.3",        "text-generation",   "Apache-2.0",            ["llm", "open-weights"]),
    ("MDL-LLA3",   "Llama 3 70B",              "3.0",      "meta-llama/Meta-Llama-3-70B-Instruct",      "text-generation",   "Meta Llama 3 License",  ["llm", "open-weights"]),
    ("MDL-LLA3S",  "Llama 3 8B",               "3.0",      "meta-llama/Meta-Llama-3-8B-Instruct",       "text-generation",   "Meta Llama 3 License",  ["llm", "open-weights"]),
    ("MDL-MIXL",   "Mixtral 8x7B",             "0.1",      "mistralai/Mixtral-8x7B-Instruct-v0.1",      "text-generation",   "Apache-2.0",            ["llm", "open-weights"]),
    ("MDL-EMBD",   "text-embedding-3-large",   "1",        "text-embedding-3-large",                    "feature-extraction","proprietary",           []),
    ("MDL-COHR",   "Command R+",               "2024-04",  "command-r-plus",                            "text-generation",   "CC-BY-NC-4.0",          ["llm"]),
]


def upgrade() -> None:
    op.bulk_insert(
        _model_cards,
        [
            {
                "id": id_, "name": name, "version": version,
                "base_model": base_model, "task_type": task_type,
                "license_name": license_name, "tags": tags,
            }
            for id_, name, version, base_model, task_type, license_name, tags in _SEEDS
        ],
    )


def downgrade() -> None:
    op.execute(
        "DELETE FROM model_cards WHERE id IN (%s)"
        % ", ".join(f"'{id_}'" for id_, *_ in _SEEDS)
    )
