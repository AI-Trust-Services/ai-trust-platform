from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException
from sqlalchemy import select, and_

from ai_trust_persistence import SessionLocal
from ai_trust_persistence.models.risk_management import (
    PlanTask,
    RiskRegister,
    ReassessmentTrigger,
)
from app.ids import new_id
from app.schemas import PlanTaskIn, PlanTaskOut, PlanTaskPatch

router = APIRouter(tags=["plan_tasks"])


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
        task = PlanTask(
            id=new_id("PTK"),
            register_id=register_id,
            risk_id=body.risk_id,
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
async def patch_plan_task(task_id: str, body: PlanTaskPatch):
    async with SessionLocal() as session:
        task = await session.get(PlanTask, task_id)
        if not task:
            raise HTTPException(status_code=404, detail="Task not found")
        if body.title is not None:
            task.title = body.title
        if body.risk_id is not None:
            task.risk_id = body.risk_id
        if body.assigned_to is not None:
            task.assigned_to = body.assigned_to
        if body.due_date is not None:
            task.due_date = body.due_date
        if body.status is not None:
            task.status = body.status
        session.add(task)
        await session.commit()
        await session.refresh(task)
        return task


@router.delete("/plan-tasks/{task_id}", status_code=204)
async def delete_plan_task(task_id: str):
    async with SessionLocal() as session:
        task = await session.get(PlanTask, task_id)
        if not task:
            raise HTTPException(status_code=404, detail="Task not found")
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
