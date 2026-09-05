"""Review notes router for POC feedback collection.

This is a hidden feature activated via Ctrl+K command palette.
No permission checks — intended for POC demos only.
"""
from __future__ import annotations

import csv
import io
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Header, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import select

from ai_trust_logging import get_logger
from ai_trust_persistence import SessionLocal
from ai_trust_persistence.models.review_note import ReviewNote
from app.ids import new_id
from app.schemas import ReviewNoteCreate, ReviewNoteUpdate, ReviewNoteResponse

router = APIRouter(tags=["review-notes"])
logger = get_logger(__name__)


@router.get("/review-notes", response_model=list[ReviewNoteResponse])
async def list_review_notes(
    page_path: str | None = Query(default=None, description="Filter by page path"),
    status: str | None = Query(default=None, description="Filter by status"),
    limit: int = Query(default=200, ge=1, le=1000),
    offset: int = Query(default=0, ge=0),
) -> list[ReviewNoteResponse]:
    """List review notes, optionally filtered by page path or status."""
    async with SessionLocal() as session:
        stmt = select(ReviewNote).order_by(ReviewNote.created_at.desc())
        if page_path:
            stmt = stmt.where(ReviewNote.page_path == page_path)
        if status:
            stmt = stmt.where(ReviewNote.status == status)
        stmt = stmt.limit(limit).offset(offset)
        result = await session.execute(stmt)
        return [ReviewNoteResponse.model_validate(r) for r in result.scalars().all()]


@router.post("/review-notes", response_model=ReviewNoteResponse, status_code=201)
async def create_review_note(
    body: ReviewNoteCreate,
    x_forwarded_preferred_username: str | None = Header(default=None),
) -> ReviewNoteResponse:
    """Create a new review note."""
    author = x_forwarded_preferred_username or "anonymous"
    async with SessionLocal() as session:
        row = ReviewNote(
            id=new_id("NOTE"),
            page_path=body.page_path,
            content=body.content,
            status="pending",
            author_username=author,
        )
        session.add(row)
        await session.commit()
        await session.refresh(row)
    logger.info("review_note.created", extra={"note_id": row.id, "page_path": row.page_path})
    return ReviewNoteResponse.model_validate(row)


@router.patch("/review-notes/{note_id}", response_model=ReviewNoteResponse)
async def update_review_note(
    note_id: str,
    body: ReviewNoteUpdate,
) -> ReviewNoteResponse:
    """Update a review note's content or status."""
    updates = body.model_dump(exclude_none=True)
    if not updates:
        raise HTTPException(422, "No fields provided to update")

    async with SessionLocal() as session:
        result = await session.execute(
            select(ReviewNote).where(ReviewNote.id == note_id)
        )
        row = result.scalar_one_or_none()
        if not row:
            raise HTTPException(404, f"Review note {note_id} not found")

        for field, value in updates.items():
            setattr(row, field, value)
        row.updated_at = datetime.now(timezone.utc)

        await session.commit()
        await session.refresh(row)
    logger.info("review_note.updated", extra={"note_id": note_id, "updates": list(updates.keys())})
    return ReviewNoteResponse.model_validate(row)


@router.delete("/review-notes/{note_id}")
async def delete_review_note(note_id: str) -> dict:
    """Delete a review note."""
    async with SessionLocal() as session:
        result = await session.execute(
            select(ReviewNote).where(ReviewNote.id == note_id)
        )
        row = result.scalar_one_or_none()
        if not row:
            raise HTTPException(404, f"Review note {note_id} not found")
        await session.delete(row)
        await session.commit()
    logger.info("review_note.deleted", extra={"note_id": note_id})
    return {"status": "deleted", "id": note_id}


@router.get("/review-notes/export")
async def export_review_notes(
    page_path: str | None = Query(default=None, description="Filter by page path"),
    status: str | None = Query(default=None, description="Filter by status"),
) -> StreamingResponse:
    """Export review notes as CSV."""
    async with SessionLocal() as session:
        stmt = select(ReviewNote).order_by(ReviewNote.created_at.desc())
        if page_path:
            stmt = stmt.where(ReviewNote.page_path == page_path)
        if status:
            stmt = stmt.where(ReviewNote.status == status)
        result = await session.execute(stmt)
        rows = result.scalars().all()

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["id", "page_path", "content", "status", "author_username", "created_at", "updated_at"])
    for row in rows:
        writer.writerow([
            row.id,
            row.page_path,
            row.content,
            row.status,
            row.author_username,
            row.created_at.isoformat() if row.created_at else "",
            row.updated_at.isoformat() if row.updated_at else "",
        ])

    output.seek(0)
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=review-notes-{timestamp}.csv"},
    )
