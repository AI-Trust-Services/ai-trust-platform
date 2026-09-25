"""Seed NVIDIA Nemotron-3-Ultra-550B model card with full dataset and benchmark data.

Revision ID: 0027
Revises: 0026
Create Date: 2026-09-25
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0027"
down_revision = "0026"
branch_labels = None
depends_on = None

_CARD_ID = "MDL-NEM550B"

_t_cards = sa.table(
    "model_cards",
    sa.column("id", sa.String),
    sa.column("name", sa.String),
    sa.column("version", sa.String),
    sa.column("base_model", sa.String),
    sa.column("library_name", sa.String),
    sa.column("license", sa.String),
    sa.column("license_name", sa.String),
    sa.column("license_link", sa.String),
    sa.column("task_type", sa.String),
    sa.column("tags", postgresql.JSONB),
)

_t_sources = sa.table(
    "model_card_sources",
    sa.column("id", sa.String),
    sa.column("model_card_id", sa.String),
    sa.column("url", sa.String),
    sa.column("name", sa.String),
)

_t_datasets = sa.table(
    "model_card_datasets",
    sa.column("id", sa.String),
    sa.column("model_card_id", sa.String),
    sa.column("name", sa.String),
    sa.column("type", sa.String),
    sa.column("revision", sa.String),
    sa.column("origin", sa.Text),
    sa.column("is_personal_data", sa.Boolean),
    sa.column("assumptions", sa.Text),
    sa.column("assessment_availability", sa.Text),
    sa.column("assessment_quantity", sa.Text),
    sa.column("assessment_suitability", sa.Text),
    sa.column("potential_biases", sa.Text),
)

_t_preps = sa.table(
    "model_card_dataset_preparations",
    sa.column("id", sa.String),
    sa.column("dataset_id", sa.String),
    sa.column("order", sa.Integer),
    sa.column("operation", sa.String),
    sa.column("description", sa.Text),
)

_t_measurements = sa.table(
    "model_card_dataset_measurements",
    sa.column("id", sa.String),
    sa.column("dataset_id", sa.String),
    sa.column("measure", sa.String),
    sa.column("value", sa.String),
)

_t_metrics = sa.table(
    "model_card_metrics",
    sa.column("id", sa.String),
    sa.column("model_card_id", sa.String),
    sa.column("name", sa.String),
    sa.column("value", sa.Float),
    sa.column("dataset", sa.String),
    sa.column("config", sa.String),
    sa.column("args", postgresql.JSONB),
)


def upgrade() -> None:
    # ── Card ────────────────────────────────────────────────────────────────
    op.bulk_insert(_t_cards, [{
        "id":           _CARD_ID,
        "name":         "NVIDIA Nemotron-3-Ultra-550B",
        "version":      "BF16",
        "base_model":   "nvidia/NVIDIA-Nemotron-3-Ultra-550B-A55B-Base-BF16",
        "library_name": "transformers",
        "license":      "other",
        "license_name": "openmdw-1.1",
        "license_link": "https://raw.githubusercontent.com/OpenMDW/OpenMDW/refs/heads/main/1.1/LICENSE.OpenMDW-1.1",
        "task_type":    "text-generation",
        "tags":         ["llm", "mixture-of-experts", "mamba", "agentic", "long-context", "open-weights"],
    }])

    # ── Source ──────────────────────────────────────────────────────────────
    op.bulk_insert(_t_sources, [{
        "id":            "NEMS-SRC-01",
        "model_card_id": _CARD_ID,
        "url":           "https://build.nvidia.com/nvidia/nemotron-3-ultra-550b-a55b/modelcard",
        "name":          "NVIDIA NIM Model Card & HuggingFace Model Card",
    }])

    # ── Datasets ─────────────────────────────────────────────────────────────
    op.bulk_insert(_t_datasets, [
        {
            "id": "NEMS-DS-01", "model_card_id": _CARD_ID,
            "name": "Nemotron-CC-v2 & v2.1", "type": "train",
            "revision": None,
            "origin": "Common Crawl web data, quality-filtered and synthetically augmented. Time period: 2013–2026.",
            "is_personal_data": None, "assumptions": None, "assessment_availability": None,
            "assessment_quantity": "9.1 Trillion tokens",
            "assessment_suitability": None,
            "potential_biases": "Demographic terms unevenly represented (e.g. 'male' > 'female'; 'White' is the most frequent ethnic label at 43–44%).",
        },
        {
            "id": "NEMS-DS-02", "model_card_id": _CARD_ID,
            "name": "Nemotron-CC-Code-v1", "type": "train",
            "revision": None,
            "origin": "Code data extracted from Common Crawl web snapshots.",
            "is_personal_data": None, "assumptions": None, "assessment_availability": None,
            "assessment_quantity": "427.9 Billion tokens",
            "assessment_suitability": None, "potential_biases": None,
        },
        {
            "id": "NEMS-DS-03", "model_card_id": _CARD_ID,
            "name": "Nemotron-Pretraining-Code (v1/v2/v3)", "type": "train",
            "revision": None,
            "origin": "Curated code data from GitHub repositories (v3: crawled through September 30, 2025; 43 programming languages).",
            "is_personal_data": None, "assumptions": None, "assessment_availability": None,
            "assessment_quantity": "1.7 Trillion tokens total (v1+v2+v3)",
            "assessment_suitability": None, "potential_biases": None,
        },
        {
            "id": "NEMS-DS-04", "model_card_id": _CARD_ID,
            "name": "Nemotron-CC-Math-v1", "type": "train",
            "revision": None,
            "origin": "Mathematics data extracted and filtered from Common Crawl.",
            "is_personal_data": None, "assumptions": None, "assessment_availability": None,
            "assessment_quantity": "133.3 Billion tokens",
            "assessment_suitability": None, "potential_biases": None,
        },
        {
            "id": "NEMS-DS-05", "model_card_id": _CARD_ID,
            "name": "Nemotron-Pretraining-Specialized (v1/v1.1/v1.2/SFT-v1)", "type": "train",
            "revision": None,
            "origin": "Synthetically generated STEM, scientific coding, factual recall, and moral scenarios data. Teacher models: Qwen3 variants, DeepSeek-R1, phi-4.",
            "is_personal_data": None, "assumptions": None, "assessment_availability": None,
            "assessment_quantity": "660 Billion tokens",
            "assessment_suitability": None, "potential_biases": None,
        },
        {
            "id": "NEMS-DS-06", "model_card_id": _CARD_ID,
            "name": "Nemotron-Pretraining-Legal-v1", "type": "train",
            "revision": None,
            "origin": "Synthetic datasets targeting legal domain capabilities. Based on CA Code of Regulations, Caselaw, and eCFR.",
            "is_personal_data": None, "assumptions": None, "assessment_availability": None,
            "assessment_quantity": "4.3 Billion tokens",
            "assessment_suitability": None, "potential_biases": None,
        },
        {
            "id": "NEMS-DS-07", "model_card_id": _CARD_ID,
            "name": "Nemotron-Posttraining-v3 – Competitive Mathematics", "type": "train",
            "revision": None,
            "origin": "Synthetic reasoning traces from competitive mathematics problem sets. Seeds: AMC, GSM8K, AIME. Teacher models: DeepSeek-R1, Qwen3 variants.",
            "is_personal_data": None, "assumptions": None, "assessment_availability": None,
            "assessment_quantity": None, "assessment_suitability": None,
            "potential_biases": "Targeted filters applied to remove traces promoting nationalistic narratives or alignment with specific political entities.",
        },
        {
            "id": "NEMS-DS-08", "model_card_id": _CARD_ID,
            "name": "Nemotron-Posttraining-v3 – Coding", "type": "train",
            "revision": None,
            "origin": "Synthetic coding solutions and reasoning traces. Seeds: SWE-Bench, in-house tasks. Teacher models: GPT-OSS-120B, DeepSeek variants.",
            "is_personal_data": None, "assumptions": None, "assessment_availability": None,
            "assessment_quantity": None, "assessment_suitability": None, "potential_biases": None,
        },
        {
            "id": "NEMS-DS-09", "model_card_id": _CARD_ID,
            "name": "Nemotron-Posttraining-v3 – Tool Calling & Agentic", "type": "train",
            "revision": None,
            "origin": "Multi-turn agentic trajectory data including Terminal-Use (~370K conversations). Seeds: in-house task environments.",
            "is_personal_data": None, "assumptions": None, "assessment_availability": None,
            "assessment_quantity": "~370K multi-turn conversations (Terminal-Use)",
            "assessment_suitability": None,
            "potential_biases": "Targeted filters applied against nationalistic and political bias.",
        },
        {
            "id": "NEMS-DS-10", "model_card_id": _CARD_ID,
            "name": "Nemotron-Posttraining-v3 – Science & Long Context", "type": "train",
            "revision": None,
            "origin": "Synthetic QA and reasoning data built from long scientific documents via passage retrieval, MCQ/OpenQA generation and paraphrasing.",
            "is_personal_data": None, "assumptions": None, "assessment_availability": None,
            "assessment_quantity": None, "assessment_suitability": None, "potential_biases": None,
        },
        {
            "id": "NEMS-DS-11", "model_card_id": _CARD_ID,
            "name": "Nemotron-Posttraining-v3 – Multilingual", "type": "train",
            "revision": None,
            "origin": "Translated and synthetically generated multilingual data. Languages: EN, FR, ES, IT, DE, JA, HI, KO, PT-BR, ZH.",
            "is_personal_data": None, "assumptions": None, "assessment_availability": None,
            "assessment_quantity": "8.6M English samples + 138K samples per additional language",
            "assessment_suitability": None, "potential_biases": None,
        },
        {
            "id": "NEMS-DS-12", "model_card_id": _CARD_ID,
            "name": "Nemotron-Posttraining-v3 – Safety", "type": "train",
            "revision": None,
            "origin": "In-house generated safety and alignment data, filtered and curated by NVIDIA.",
            "is_personal_data": None, "assumptions": None, "assessment_availability": None,
            "assessment_quantity": None, "assessment_suitability": None,
            "potential_biases": "Explicitly filtered for nationalistic and political bias via keyword- and regex-based removal.",
        },
    ])

    # ── Dataset preparations ─────────────────────────────────────────────────
    op.bulk_insert(_t_preps, [
        {"id": "NEMS-PR-01-01", "dataset_id": "NEMS-DS-01", "order": 1, "operation": "quality_filtering",           "description": "Automated quality filtering pipeline on Common Crawl snapshots; synthetic high-quality web data (syn-crawl-high) also included."},
        {"id": "NEMS-PR-02-01", "dataset_id": "NEMS-DS-02", "order": 1, "operation": "extraction",                  "description": "Automated extraction of code tokens from Common Crawl snapshots."},
        {"id": "NEMS-PR-03-01", "dataset_id": "NEMS-DS-03", "order": 1, "operation": "curation",                    "description": "Quality-filtered GitHub code across 43 programming languages."},
        {"id": "NEMS-PR-04-01", "dataset_id": "NEMS-DS-04", "order": 1, "operation": "filtering",                   "description": "Mathematics-specific quality filtering applied to web crawl data."},
        {"id": "NEMS-PR-05-01", "dataset_id": "NEMS-DS-05", "order": 1, "operation": "synthetic_generation",        "description": "Synthetic data generation via teacher models (Qwen3, DeepSeek-R1, phi-4). Automated verification via compilers, numerical checks, and language ID."},
        {"id": "NEMS-PR-06-01", "dataset_id": "NEMS-DS-06", "order": 1, "operation": "synthetic_generation",        "description": "Synthetically generated from public legal corpora (CA Code of Regulations, Caselaw, eCFR)."},
        {"id": "NEMS-PR-07-01", "dataset_id": "NEMS-DS-07", "order": 1, "operation": "synthetic_generation",        "description": "Step-by-step reasoning trace distillation from teacher models; numerical verification; best-of-n selection."},
        {"id": "NEMS-PR-07-02", "dataset_id": "NEMS-DS-07", "order": 2, "operation": "filtering",                   "description": "Unified quality and license filtering; removal of repetitive traces."},
        {"id": "NEMS-PR-08-01", "dataset_id": "NEMS-DS-08", "order": 1, "operation": "synthetic_generation",        "description": "Distillation via GPT-OSS-120B and DeepSeek; compiler-based verification."},
        {"id": "NEMS-PR-08-02", "dataset_id": "NEMS-DS-08", "order": 2, "operation": "filtering",                   "description": "Structural checks and repetition filters."},
        {"id": "NEMS-PR-09-01", "dataset_id": "NEMS-DS-09", "order": 1, "operation": "synthetic_generation",        "description": "Distillation of agentic trajectories from agent systems and teacher models; grounded in real tasks and documents."},
        {"id": "NEMS-PR-09-02", "dataset_id": "NEMS-DS-09", "order": 2, "operation": "filtering",                   "description": "Structural checks (missing tool definitions) and repetition filters."},
        {"id": "NEMS-PR-10-01", "dataset_id": "NEMS-DS-10", "order": 1, "operation": "retrieval_augmented_generation", "description": "Passage retrieval from long scientific documents; MCQ/OpenQA generation; multi-format paraphrasing."},
        {"id": "NEMS-PR-10-02", "dataset_id": "NEMS-DS-10", "order": 2, "operation": "filtering",                   "description": "Quality filtering and language identification."},
        {"id": "NEMS-PR-11-01", "dataset_id": "NEMS-DS-11", "order": 1, "operation": "translation",                 "description": "Synthetic translation and multilingual data generation via teacher models."},
        {"id": "NEMS-PR-12-01", "dataset_id": "NEMS-DS-12", "order": 1, "operation": "filtering",                   "description": "Keyword- and regex-based removal of politically biased and nationalistic content; structural quality checks."},
    ])

    # ── Dataset measurements ─────────────────────────────────────────────────
    op.bulk_insert(_t_measurements, [
        {"id": "NEMS-MS-01-01", "dataset_id": "NEMS-DS-01", "measure": "token_count",              "value": "9.1T"},
        {"id": "NEMS-MS-01-02", "dataset_id": "NEMS-DS-01", "measure": "time_period",              "value": "2013–2026"},
        {"id": "NEMS-MS-02-01", "dataset_id": "NEMS-DS-02", "measure": "token_count",              "value": "427.9B"},
        {"id": "NEMS-MS-02-02", "dataset_id": "NEMS-DS-02", "measure": "source",                   "value": "Common Crawl"},
        {"id": "NEMS-MS-03-01", "dataset_id": "NEMS-DS-03", "measure": "token_count",              "value": "1.7T"},
        {"id": "NEMS-MS-03-02", "dataset_id": "NEMS-DS-03", "measure": "programming_languages",    "value": "43"},
        {"id": "NEMS-MS-04-01", "dataset_id": "NEMS-DS-04", "measure": "token_count",              "value": "133.3B"},
        {"id": "NEMS-MS-04-02", "dataset_id": "NEMS-DS-04", "measure": "domain",                   "value": "mathematics"},
        {"id": "NEMS-MS-05-01", "dataset_id": "NEMS-DS-05", "measure": "token_count",              "value": "660B"},
        {"id": "NEMS-MS-05-02", "dataset_id": "NEMS-DS-05", "measure": "generation_method",        "value": "Synthetic (teacher model distillation)"},
        {"id": "NEMS-MS-06-01", "dataset_id": "NEMS-DS-06", "measure": "token_count",              "value": "4.3B"},
        {"id": "NEMS-MS-06-02", "dataset_id": "NEMS-DS-06", "measure": "domain",                   "value": "legal"},
        {"id": "NEMS-MS-07-01", "dataset_id": "NEMS-DS-07", "measure": "generation_method",        "value": "Synthetic (teacher model distillation)"},
        {"id": "NEMS-MS-08-01", "dataset_id": "NEMS-DS-08", "measure": "generation_method",        "value": "Synthetic (compiler-verified)"},
        {"id": "NEMS-MS-09-01", "dataset_id": "NEMS-DS-09", "measure": "conversations_terminal",   "value": "~370K"},
        {"id": "NEMS-MS-09-02", "dataset_id": "NEMS-DS-09", "measure": "generation_method",        "value": "Synthetic (agentic distillation)"},
        {"id": "NEMS-MS-10-01", "dataset_id": "NEMS-DS-10", "measure": "generation_method",        "value": "Synthetic (RAG-based QA generation)"},
        {"id": "NEMS-MS-11-01", "dataset_id": "NEMS-DS-11", "measure": "english_samples",          "value": "8.6M"},
        {"id": "NEMS-MS-11-02", "dataset_id": "NEMS-DS-11", "measure": "samples_per_language",     "value": "138K"},
        {"id": "NEMS-MS-11-03", "dataset_id": "NEMS-DS-11", "measure": "languages",                "value": "10 (+ English)"},
        {"id": "NEMS-MS-12-01", "dataset_id": "NEMS-DS-12", "measure": "generation_method",        "value": "In-house / Synthetic"},
    ])

    # ── Benchmark metrics ────────────────────────────────────────────────────
    op.bulk_insert(_t_metrics, [
        {"id": "NEMS-MT-01", "model_card_id": _CARD_ID, "name": "Terminal Bench 2.1",          "value": 56.4,  "dataset": "external_benchmark", "config": None, "args": {"type": "accuracy"}},
        {"id": "NEMS-MT-02", "model_card_id": _CARD_ID, "name": "SWE-Bench Verified",           "value": 71.9,  "dataset": "external_benchmark", "config": None, "args": {"type": "accuracy"}},
        {"id": "NEMS-MT-03", "model_card_id": _CARD_ID, "name": "SWE-Bench Multilingual",       "value": 67.7,  "dataset": "external_benchmark", "config": None, "args": {"type": "accuracy"}},
        {"id": "NEMS-MT-04", "model_card_id": _CARD_ID, "name": "PinchBench",                   "value": 90.0,  "dataset": "external_benchmark", "config": None, "args": {"type": "accuracy"}},
        {"id": "NEMS-MT-05", "model_card_id": _CARD_ID, "name": "TauBench V3 Average",          "value": 70.9,  "dataset": "external_benchmark", "config": None, "args": {"type": "accuracy", "breakdown": "Airline: 81.5 | Retail: 86.4 | Telecom: 92.9 | Banking: 22.6"}},
        {"id": "NEMS-MT-06", "model_card_id": _CARD_ID, "name": "GDPVal",                       "value": 46.7,  "dataset": "external_benchmark", "config": None, "args": {"type": "accuracy"}},
        {"id": "NEMS-MT-07", "model_card_id": _CARD_ID, "name": "BrowseComp",                   "value": 44.4,  "dataset": "external_benchmark", "config": None, "args": {"type": "accuracy"}},
        {"id": "NEMS-MT-08", "model_card_id": _CARD_ID, "name": "IOI 2025",                     "value": 570.0, "dataset": "external_benchmark", "config": None, "args": {"type": "score"}},
        {"id": "NEMS-MT-09", "model_card_id": _CARD_ID, "name": "GPQA (no tools)",              "value": 87.0,  "dataset": "external_benchmark", "config": None, "args": {"type": "accuracy"}},
        {"id": "NEMS-MT-10", "model_card_id": _CARD_ID, "name": "SciCode (subtask)",            "value": 44.6,  "dataset": "external_benchmark", "config": None, "args": {"type": "accuracy"}},
        {"id": "NEMS-MT-11", "model_card_id": _CARD_ID, "name": "HLE (no tools)",               "value": 26.7,  "dataset": "external_benchmark", "config": None, "args": {"type": "accuracy"}},
        {"id": "NEMS-MT-12", "model_card_id": _CARD_ID, "name": "OmniScience Accuracy",         "value": 24.1,  "dataset": "external_benchmark", "config": None, "args": {"type": "accuracy"}},
        {"id": "NEMS-MT-13", "model_card_id": _CARD_ID, "name": "OmniScience Non-Hallucination","value": 78.7,  "dataset": "external_benchmark", "config": None, "args": {"type": "accuracy"}},
        {"id": "NEMS-MT-14", "model_card_id": _CARD_ID, "name": "MMLU-Pro",                     "value": 86.8,  "dataset": "external_benchmark", "config": None, "args": {"type": "accuracy"}},
        {"id": "NEMS-MT-15", "model_card_id": _CARD_ID, "name": "IFBench (prompt)",             "value": 81.7,  "dataset": "external_benchmark", "config": None, "args": {"type": "accuracy"}},
        {"id": "NEMS-MT-16", "model_card_id": _CARD_ID, "name": "RULER 1M",                     "value": 94.7,  "dataset": "external_benchmark", "config": None, "args": {"type": "accuracy"}},
        {"id": "NEMS-MT-17", "model_card_id": _CARD_ID, "name": "AA-LCR",                       "value": 65.4,  "dataset": "external_benchmark", "config": None, "args": {"type": "accuracy"}},
    ])


def downgrade() -> None:
    # CASCADE on all child FKs — deleting the card removes everything
    op.execute(f"DELETE FROM model_cards WHERE id = '{_CARD_ID}'")
