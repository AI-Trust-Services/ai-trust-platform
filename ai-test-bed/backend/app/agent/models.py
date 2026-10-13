"""Pydantic v2 output types for the knowledge-grounded task agent."""

from __future__ import annotations

from pydantic import BaseModel


class SourceReference(BaseModel):
    """A citation to a retrieved passage used in the answer."""

    ref_id: str
    """Stable reference ID assigned by the citations module (e.g. ``L-abc123``)."""
    quote: str | None = None
    """Optional verbatim excerpt from the source passage."""


class AppliedJudgment(BaseModel):
    """A reviewed expert judgment that applies to the current task."""

    ref_id: str
    """Reference ID of the reviewed-judgment passage (prefix ``J-``)."""
    statement: str
    """One-sentence summary of why the judgment applies."""


class TaskResult(BaseModel):
    """Structured output produced by the task agent."""

    proposed_answer: str
    """The agent's substantive answer to the task."""
    rationale: str
    """Reasoning that connects the evidence to the proposed answer."""
    source_references: list[SourceReference] = []
    """Citations to retrieved passages that support the answer."""
    applicable_judgments: list[AppliedJudgment] = []
    """Reviewed expert judgments that influenced the answer."""
    missing_facts: list[str] = []
    """Factual gaps that prevented a fully confident answer."""
    review_required: bool = False
    """True if a human reviewer should check this result."""
    review_questions: list[str] = []
    """Open questions a reviewer should address."""
