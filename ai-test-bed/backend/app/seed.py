"""Seed the AI Test Bed sample fixtures into the database.

Run once (idempotent) via:
    python -m app.seed

What this does:
  1. Creates an ``AISystem`` stub row for each test-bed sample (SYS-TBHIRING,
     SYS-TBCHATBOT, SYS-TBCREDIT) and for the EU AI Act sentinel
     (``__eu_ai_act__``) if they do not already exist (direct DB write via the
     shared persistence lib).
  2. For each sample system: POSTs the sample's Markdown system card to the
     document-indexing backend ``POST /v1/systems/{id}/documents`` if no
     document exists yet. The running ``document-indexing-worker`` picks up the
     pending version and indexes it asynchronously.

The upload uses APP_ADMIN_USERNAME as the forwarded user so the
document-indexing backend's ``systems:write`` permission check passes.

Idempotency: all checks are "skip if already exists". Re-running is safe.

Env vars required:
  DATABASE_URL     — for direct AISystem stub creation
  INDEXING_BACKEND_URL — document-indexing backend
                         (default http://document-indexing-backend:8011)
  APP_ADMIN_USERNAME   — forwarded as x-forwarded-preferred-username
                         (default "admin")
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

import httpx
from ai_trust_persistence import SessionLocal
from ai_trust_persistence.models import AISystem, Document
from sqlalchemy import select

_SAMPLE_DOCS_DIR = Path(__file__).parent / "testbed" / "sample_docs"

_EU_AI_ACT_ID = "__eu_ai_act__"

_SAMPLE_SYSTEMS: list[dict] = [
    {
        "id": "SYS-TBHIRING",
        "name": "[Test Bed] Automated Hiring Screener",
        "description": (
            "AI Test Bed sample — automated CV ranking and candidate shortlisting "
            "for HR. Expected EU AI Act tier: High (Annex III, point 4)."
        ),
        "tier": "pending",
        "sample_dir": "tbs-hiring-screener",
    },
    {
        "id": "SYS-TBCHATBOT",
        "name": "[Test Bed] Internal Knowledge Assistant",
        "description": (
            "AI Test Bed sample — conversational knowledge assistant on the company "
            "intranet. Expected EU AI Act tier: Limited (Art. 50 chatbot)."
        ),
        "tier": "pending",
        "sample_dir": "tbs-internal-chatbot",
    },
    {
        "id": "SYS-TBCREDIT",
        "name": "[Test Bed] Retail Credit Risk Scorer",
        "description": (
            "AI Test Bed sample — ML-based credit risk scoring for personal loan "
            "applications. Expected EU AI Act tier: High (Annex III, point 5)."
        ),
        "tier": "pending",
        "sample_dir": "tbs-credit-scoring",
    },
]

_EU_AI_ACT_SYSTEM: dict = {
    "id": _EU_AI_ACT_ID,
    "name": "[Test Bed] EU AI Act (upload target)",
    "description": (
        "Sentinel AI system for EU AI Act document corpus. "
        "Upload PDF/text files via the Test Bed UI to populate retrieval context."
    ),
    "tier": "pending",
}


async def _ensure_ai_system(
    session, system_id: str, name: str, description: str, tier: str
) -> bool:
    exists = (
        await session.execute(select(AISystem.id).where(AISystem.id == system_id))
    ).scalar_one_or_none()
    if exists is not None:
        print(f"  [skip] AISystem {system_id!r} already exists")
        return False
    row = AISystem(id=system_id, name=name, description=description, tier=tier)
    session.add(row)
    print(f"  [create] AISystem {system_id!r} — {name}")
    return True


async def _seed_sample_docs(
    system_id: str,
    sample_dir: str,
    client: httpx.AsyncClient,
    upload_url_base: str,
    admin_user: str,
) -> None:
    doc_dir = _SAMPLE_DOCS_DIR / sample_dir
    if not doc_dir.is_dir():
        print(f"  [skip] sample_docs/{sample_dir}/ not found — no documents to seed")
        return

    async with SessionLocal() as session:
        existing = (
            await session.execute(
                select(Document.id).where(Document.ai_system_id == system_id).limit(1)
            )
        ).scalar_one_or_none()
    if existing is not None:
        print(f"  [skip] documents for {system_id!r} already seeded")
        return

    md_files = sorted(doc_dir.glob("*.md"))
    if not md_files:
        print(f"  [skip] no .md files found in sample_docs/{sample_dir}/")
        return

    for md_path in md_files:
        data = md_path.read_bytes()
        filename = md_path.name
        try:
            resp = await client.post(
                f"{upload_url_base}/v1/systems/{system_id}/documents",
                files={"file": (filename, data, "text/markdown")},
                headers={"x-forwarded-preferred-username": admin_user},
            )
            if resp.status_code in (200, 201):
                print(f"  [upload] {filename!r} → uploaded (pending indexing)")
            else:
                print(
                    f"  [warn] upload {filename!r} returned {resp.status_code}: {resp.text[:200]}"
                )
        except httpx.RequestError as exc:
            print(f"  [error] upload {filename!r} failed: {exc}", file=sys.stderr)


async def seed() -> None:
    import os

    indexing_url = os.environ.get(
        "INDEXING_BACKEND_URL", "http://document-indexing-backend:8011"
    )
    admin_user = os.environ.get("APP_ADMIN_USERNAME", "admin")

    print("=== AI Test Bed seed ===")

    async with SessionLocal() as session:
        print("\n-- EU AI Act sentinel")
        await _ensure_ai_system(
            session,
            _EU_AI_ACT_ID,
            _EU_AI_ACT_SYSTEM["name"],
            _EU_AI_ACT_SYSTEM["description"],
            _EU_AI_ACT_SYSTEM["tier"],
        )
        for s in _SAMPLE_SYSTEMS:
            print(f"\n-- {s['id']}")
            await _ensure_ai_system(
                session, s["id"], s["name"], s["description"], s["tier"]
            )
        await session.commit()

    async with httpx.AsyncClient(timeout=60.0) as client:
        for s in _SAMPLE_SYSTEMS:
            print(f"\n-- docs for {s['id']}")
            await _seed_sample_docs(
                s["id"], s["sample_dir"], client, indexing_url, admin_user
            )

    print("\n=== seed complete ===")


if __name__ == "__main__":
    try:
        asyncio.run(seed())
    except Exception as exc:  # noqa: BLE001
        print(f"Seed failed: {exc}", file=sys.stderr)
        sys.exit(1)
