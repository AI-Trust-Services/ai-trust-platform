from __future__ import annotations
import uuid


def new_id(prefix: str) -> str:
    """Return an ID like RRM-3F2A1B4C.

    Prefixes: RRM (RiskRegister), RSK (RiskEntry), MIS (MisuseScenario),
              MIT (MitigationMeasure), RAT (ReassessmentTrigger).
    """
    return f"{prefix}-{uuid.uuid4().hex[:8].upper()}"
