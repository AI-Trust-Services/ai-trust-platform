from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Request
from sqlalchemy import select, and_

from ai_trust_authorization import get_current_user
from ai_trust_persistence import SessionLocal
from ai_trust_persistence.models.risk_management import (
    PlanTask,
    RiskEntry,
    RiskRegister,
    ReassessmentTrigger,
)
from app.ids import new_id
from app.owner_auth import authorize_owner_action, authorize_owner_or_reviewer_action
from app.schemas import PlanTaskIn, PlanTaskOut, PlanTaskPatch
from app.routers.registers import _reopen_if_approved

router = APIRouter(tags=["plan_tasks"])


async def _register_id_for_task(session, task_id: str) -> str | None:
    result = await session.execute(select(PlanTask.register_id).where(PlanTask.id == task_id))
    return result.scalar_one_or_none()


async def _owner_for_task(session, task: PlanTask) -> str | None:
    """The linked risk's risk_owner takes precedence; falls back to assigned_to
    when the task isn't linked to a risk (or that risk has no owner set)."""
    if task.risk_id:
        risk = await session.get(RiskEntry, task.risk_id)
        if risk and risk.risk_owner:
            return risk.risk_owner
    return task.assigned_to



@router.get("/registers/{register_id}/plan-tasks", response_model=list[PlanTaskOut])
async def list_plan_tasks(register_id: str):
    async with SessionLocal() as session:
        result = await session.execute(
            select(PlanTask)
            .where(PlanTask.register_id == register_id)
            .order_by(PlanTask.due_date.asc().nullslast(), PlanTask.created_at.asc())
        )
        return result.scalars().all()


@router.post("/registers/{register_id}/plan-tasks", response_model=PlanTaskOut, status_code=201)
async def create_plan_task(register_id: str, body: PlanTaskIn):
    async with SessionLocal() as session:
        register = await session.get(RiskRegister, register_id)
        if not register:
            raise HTTPException(status_code=404, detail="Register not found")
        if not body.title or not body.title.strip():
            raise HTTPException(status_code=422, detail="Task title is required.")
        # If the register was approved, this clones it to a new draft and
        # archives the original — the new task must be created under the new
        # draft, not the (now-archived) register_id the caller passed in.
        register_id = await _reopen_if_approved(session, register_id)
        task = PlanTask(
            id=new_id("PTK"),
            register_id=register_id,
            risk_id=body.risk_id,
            mitigation_id=body.mitigation_id,
            title=body.title,
            assigned_to=body.assigned_to,
            due_date=body.due_date,
            status=body.status,
        )
        session.add(task)
        await session.commit()
        await session.refresh(task)
        return task


@router.patch("/plan-tasks/{task_id}", response_model=PlanTaskOut)
async def patch_plan_task(task_id: str, body: PlanTaskPatch, request: Request):
    async with SessionLocal() as session:
        task = await session.get(PlanTask, task_id)
        if not task:
            raise HTTPException(status_code=404, detail="Task not found")
        register_id = await _register_id_for_task(session, task_id)
        if register_id:
            await _reopen_if_approved(session, register_id)
        if body.title is not None and not body.title.strip():
            raise HTTPException(status_code=422, detail="Task title cannot be empty.")
        provided = body.model_dump(exclude_unset=True)
        if "approved" in provided and provided["approved"] != task.approved:
            owner = await _owner_for_task(session, task)
            approver = await authorize_owner_action(request, owner)
            task.approved = provided["approved"]
            task.approved_by = approver if provided["approved"] else None
            task.approved_at = datetime.now(timezone.utc) if provided["approved"] else None
        # Two-step delete: any user may propose (pending_delete=True); only the
        # risk owner or the register's reviewer may cancel (pending_delete=False).
        if "pending_delete" in provided and provided["pending_delete"] != task.pending_delete:
            if provided["pending_delete"]:
                task.pending_delete = True
                task.pending_delete_by = get_current_user(request)
                task.pending_delete_at = datetime.now(timezone.utc)
            else:
                owner = await _owner_for_task(session, task)
                register = await session.get(RiskRegister, task.register_id)
                await authorize_owner_or_reviewer_action(
                    request, owner, register.reviewer_username if register else None
                )
                task.pending_delete = False
                task.pending_delete_by = None
                task.pending_delete_at = None
        for field in ("title", "description", "risk_id", "mitigation_id", "assigned_to", "due_date", "status"):
            if field in provided:
                setattr(task, field, provided[field])
        session.add(task)
        await session.commit()
        await session.refresh(task)
        return task


@router.delete("/plan-tasks/{task_id}", status_code=204)
async def delete_plan_task(task_id: str, request: Request):
    async with SessionLocal() as session:
        task = await session.get(PlanTask, task_id)
        if not task:
            raise HTTPException(status_code=404, detail="Task not found")
        # A task that has been marked for deletion may only actually be deleted
        # by the risk owner or the register's reviewer; an unmarked task (e.g.
        # direct delete on a draft register) is deleted immediately, as before.
        if task.pending_delete:
            owner = await _owner_for_task(session, task)
            register = await session.get(RiskRegister, task.register_id)
            await authorize_owner_or_reviewer_action(
                request, owner, register.reviewer_username if register else None
            )
        register_id = await _register_id_for_task(session, task_id)
        if register_id:
            await _reopen_if_approved(session, register_id)
        await session.delete(task)
        await session.commit()


@router.post("/registers/{register_id}/check-overdue-tasks", status_code=204)
async def check_overdue_tasks(register_id: str):
    """Check for overdue tasks and create ReassessmentTriggers for each one not yet triggered."""
    async with SessionLocal() as session:
        register = await session.get(RiskRegister, register_id)
        if not register:
            raise HTTPException(status_code=404, detail="Register not found")

        now = datetime.now(timezone.utc)

        overdue_result = await session.execute(
            select(PlanTask).where(
                and_(
                    PlanTask.register_id == register_id,
                    PlanTask.due_date < now,
                    PlanTask.status != "done",
                )
            )
        )
        overdue_tasks = overdue_result.scalars().all()

        for task in overdue_tasks:
            reason = f"Task overdue: {task.title}"
            existing = await session.execute(
                select(ReassessmentTrigger).where(
                    and_(
                        ReassessmentTrigger.ai_system_id == register.ai_system_id,
                        ReassessmentTrigger.trigger_type == "task_overdue",
                        ReassessmentTrigger.trigger_reason == reason,
                        ReassessmentTrigger.acknowledged == False,  # noqa: E712
                    )
                )
            )
            if existing.scalar_one_or_none() is None:
                trigger = ReassessmentTrigger(
                    id=new_id("RAT"),
                    ai_system_id=register.ai_system_id,
                    trigger_type="task_overdue",
                    trigger_reason=reason,
                    triggered_at=now,
                )
                session.add(trigger)

        await session.commit()
