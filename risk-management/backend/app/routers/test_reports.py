from __future__ import annotations

from fastapi import APIRouter, HTTPException
from sqlalchemy import select

from ai_trust_persistence import SessionLocal
from ai_trust_persistence.models.risk_management import RiskEntry, TestReport
from app.ids import new_id
from app.schemas import TestReportIn, TestReportOut
from app.routers.registers import _reopen_if_approved

router = APIRouter(tags=["test_reports"])


async def _register_id_for_risk(session, risk_id: str) -> str | None:
    result = await session.execute(select(RiskEntry.register_id).where(RiskEntry.id == risk_id))
    return result.scalar_one_or_none()


async def _register_id_for_report(session, report_id: str) -> str | None:
    result = await session.execute(
        select(RiskEntry.register_id)
        .join(TestReport, TestReport.risk_id == RiskEntry.id)
        .where(TestReport.id == report_id)
    )
    return result.scalar_one_or_none()


@router.get("/risks/{risk_id}/test-reports", response_model=list[TestReportOut])
async def list_test_reports(risk_id: str):
    async with SessionLocal() as session:
        result = await session.execute(
            select(TestReport).where(TestReport.risk_id == risk_id).order_by(TestReport.created_at.desc())
        )
        return result.scalars().all()


@router.post("/risks/{risk_id}/test-reports", response_model=TestReportOut, status_code=201)
async def create_test_report(risk_id: str, body: TestReportIn):
    async with SessionLocal() as session:
        risk = await session.get(RiskEntry, risk_id)
        if not risk:
            raise HTTPException(status_code=404, detail="Risk not found")
        if not body.title or not body.title.strip():
            raise HTTPException(status_code=422, detail="Test report title is required.")
        register_id = await _register_id_for_risk(session, risk_id)
        if register_id:
            await _reopen_if_approved(session, register_id)
        row = TestReport(
            id=new_id("TRP"),
            risk_id=risk_id,
            title=body.title,
            summary=body.summary,
            findings=body.findings,
            result=body.result,
            author=body.author,
            attachments=body.attachments,
            mitigation_id=body.mitigation_id,
        )
        session.add(row)
        await session.commit()
        await session.refresh(row)
        return row


@router.delete("/test-reports/{report_id}", status_code=204)
async def delete_test_report(report_id: str):
    async with SessionLocal() as session:
        row = await session.get(TestReport, report_id)
        if not row:
            raise HTTPException(status_code=404, detail="Test report not found")
        register_id = await _register_id_for_report(session, report_id)
        if register_id:
            await _reopen_if_approved(session, register_id)
        await session.delete(row)
        await session.commit()
