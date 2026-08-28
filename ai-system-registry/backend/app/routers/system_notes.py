"""System notes router — CRUD for notes attached to AI systems."""
from __future__ import annotations

import logging
from typing import Annotated

from fastapi import APIRouter, Header, HTTPException
from sqlalchemy import select

from ai_trust_persistence.database import SessionLocal
from ai_trust_persistence.models import SystemNote

from app.ids import new_id
from app.schemas.system_note import (
    SystemNoteCreate,
    SystemNoteResponse,
    SystemNoteUpdate,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/systems/{system_id}/notes", tags=["system-notes"])


def _username(header: str | None) -> str:
    return header or "anonymous"


@router.get("", response_model=list[SystemNoteResponse])
async def list_notes(
    system_id: str,
    x_forwarded_preferred_username: Annotated[str | None, Header()] = None,
) -> list[SystemNoteResponse]:
    """List all notes for a system, newest first."""
    async with SessionLocal() as session:
        result = await session.execute(
            select(SystemNote)
            .where(SystemNote.ai_system_id == system_id)
            .order_by(SystemNote.created_at.desc())
        )
        notes = result.scalars().all()
        return [SystemNoteResponse.model_validate(n) for n in notes]


@router.post("", response_model=SystemNoteResponse, status_code=201)
async def create_note(
    system_id: str,
    data: SystemNoteCreate,
    x_forwarded_preferred_username: Annotated[str | None, Header()] = None,
) -> SystemNoteResponse:
    """Create a new note for a system."""
    username = _username(x_forwarded_preferred_username)

    async with SessionLocal() as session:
        note = SystemNote(
            id=new_id("SNOTE"),
            ai_system_id=system_id,
            content=data.content,
            author_username=username,
        )
        session.add(note)
        await session.commit()
        await session.refresh(note)

        logger.info(
            "system_note.created",
            extra={"note_id": note.id, "system_id": system_id, "author": username},
        )
        return SystemNoteResponse.model_validate(note)


@router.patch("/{note_id}", response_model=SystemNoteResponse)
async def update_note(
    system_id: str,
    note_id: str,
    data: SystemNoteUpdate,
    x_forwarded_preferred_username: Annotated[str | None, Header()] = None,
) -> SystemNoteResponse:
    """Update a note's content."""
    async with SessionLocal() as session:
        result = await session.execute(
            select(SystemNote).where(
                SystemNote.id == note_id,
                SystemNote.ai_system_id == system_id,
            )
        )
        note = result.scalar_one_or_none()
        if not note:
            raise HTTPException(status_code=404, detail="Note not found")

        if data.content is not None:
            note.content = data.content

        await session.commit()
        await session.refresh(note)

        logger.info("system_note.updated", extra={"note_id": note_id})
        return SystemNoteResponse.model_validate(note)


@router.delete("/{note_id}", status_code=204)
async def delete_note(
    system_id: str,
    note_id: str,
    x_forwarded_preferred_username: Annotated[str | None, Header()] = None,
):
    """Delete a note."""
    async with SessionLocal() as session:
        result = await session.execute(
            select(SystemNote).where(
                SystemNote.id == note_id,
                SystemNote.ai_system_id == system_id,
            )
        )
        note = result.scalar_one_or_none()
        if not note:
            raise HTTPException(status_code=404, detail="Note not found")

        await session.delete(note)
        await session.commit()

        logger.info("system_note.deleted", extra={"note_id": note_id})
