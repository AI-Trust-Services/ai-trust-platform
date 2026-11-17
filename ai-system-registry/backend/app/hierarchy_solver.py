"""Hierarchy solver — pure function, no I/O.

Resolves a classification pipeline result to a single risk winner and a list of
role labels, applying optional user overrides and computing confidence bands.
"""

from __future__ import annotations

from app.schemas.hierarchy_solver import LabelOverrides, ResolveResponse


def solve(
    pipeline_result: dict,
    overrides: LabelOverrides | None,
    questionnaire_result: dict | None = None,
) -> ResolveResponse:
    """Resolve pipeline_result into a ResolveResponse.

    Stub — raises NotImplementedError until step 6.
    """
    raise NotImplementedError("hierarchy_solver.solve() not yet implemented")
