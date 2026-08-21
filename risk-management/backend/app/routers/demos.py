from __future__ import annotations

from fastapi import APIRouter

from ai_trust_logging import get_logger
from app.schemas.demo import DemoListResponse, DemoSystemResponse

router = APIRouter(tags=["demos"])
logger = get_logger(__name__)

_DEMOS = {
    "creditsense": {
        "id": "creditsense",
        "name": "CreditSense v2.1",
        "description": "Automated credit-scoring system for retail loan applications.",
        "annex_iii_point": "5b",
        "annex_iii_category": "essential_services",
    },
    "hirefilter": {
        "id": "hirefilter",
        "name": "HireFilter v1.4",
        "description": "CV screening and candidate ranking tool for high-volume recruitment.",
        "annex_iii_point": "4a",
        "annex_iii_category": "employment",
    },
}


@router.get("/demos", response_model=DemoListResponse)
async def list_demos() -> DemoListResponse:
    logger.info("demos.list")
    return DemoListResponse(demos=list(_DEMOS.values()))


@router.get("/demos/{demo_id}", response_model=DemoSystemResponse)
async def get_demo(demo_id: str) -> DemoSystemResponse:
    import json
    from pathlib import Path

    demo_dir = Path(__file__).parent.parent.parent / "demo" / demo_id
    if not demo_dir.exists() or demo_id not in _DEMOS:
        from fastapi import HTTPException
        raise HTTPException(404, f"Demo '{demo_id}' not found")

    description = (demo_dir / "system_description.md").read_text(encoding="utf-8")
    metadata = json.loads((demo_dir / "metadata.json").read_text(encoding="utf-8"))

    logger.info("demos.loaded", extra={"demo_id": demo_id})
    return DemoSystemResponse(
        **_DEMOS[demo_id],
        system_description=description,
        metadata=metadata,
    )
