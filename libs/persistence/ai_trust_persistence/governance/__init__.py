"""Shared governance logic: obligation/requirement templates, status cascade, and
the in-session generation used by both the compliance and registry services.

Public API re-exported here so callers import from one place:
    from ai_trust_persistence.governance import (
        obligations_for, requirements_for, cluster_articles,
        generate_obligations_in_session, generate_requirements_in_session,
        refresh_obligation, refresh_assessment_score, sync_system_compliance,
        refresh_requirement_effectiveness, refresh_obligations_for_requirement,
    )
"""

from ai_trust_persistence.governance.cascade import (
    refresh_assessment_score,
    refresh_obligation,
    refresh_obligations_for_requirement,
    refresh_requirement_effectiveness,
    sync_system_compliance,
)
from ai_trust_persistence.governance.generation import (
    generate_obligations_in_session,
    generate_requirements_in_session,
)
from ai_trust_persistence.governance.obligation_templates import obligations_for
from ai_trust_persistence.governance.requirement_templates import (
    cluster_articles,
    requirements_for,
)

__all__ = [
    "obligations_for",
    "requirements_for",
    "cluster_articles",
    "generate_obligations_in_session",
    "generate_requirements_in_session",
    "refresh_assessment_score",
    "refresh_obligation",
    "refresh_obligations_for_requirement",
    "refresh_requirement_effectiveness",
    "sync_system_compliance",
]
