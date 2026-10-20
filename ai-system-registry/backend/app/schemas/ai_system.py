"""Pydantic v2 schemas for AI System."""

from __future__ import annotations

from datetime import date, datetime
from typing import Literal
from urllib.parse import urlparse

from pydantic import BaseModel, Field, field_validator

VALID_LIFECYCLES = frozenset(
    {
        "development",
        "testing",
        "prod_ready",
        "market",
        "service",
        "updated",
        "decommissioned",
    }
)
VALID_ROLES = frozenset(
    {
        "provider",
        "deployer",
        "both",
        "importer",
        "distributor",
        "authorised_representative",
    }
)
# The six canonical EU AI Act tiers — enforced by ck_ai_systems_tier at the DB layer.
# Validated in the API layer for CO overrides / full-manual entry so a bad value
# returns 422 instead of 500-ing on commit.
VALID_TIERS = frozenset(
    {
        "prohibited",
        "gpai-systemic",
        "gpai-standard",
        "high",
        "limited",
        "minimal",
        "pending",
    }
)
VALID_REGISTRATION_MODES = frozenset({"ai", "manual_questionnaire", "full_manual"})


class RationaleItem(BaseModel):
    """One LLM-inferred classifier flag with its rationale + confidence."""

    flag: str
    value: bool | float
    rationale: str
    confidence: float = Field(ge=0.0, le=1.0)


class ClassificationRationale(BaseModel):
    """Extended classification output from the questionnaire workflow — visible only to the CO.

    Distinct from the legacy bare ``list[RationaleItem]`` written by AI-assisted intake;
    readers discriminate the two shapes with ``isinstance``/``Array.isArray``.
    """

    flags: list[RationaleItem] = []
    confidence: float | None = None
    reasoning: str | None = None
    missing_info: list[str] = []


class RegistrationDocument(BaseModel):
    """One supporting document uploaded in the full-manual override flow."""

    filename: str
    minio_key: str
    uploaded_at: datetime


class DownloadUrlResponse(BaseModel):
    url: str


class AISystemCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    description: str = Field(default="")
    assignee_username: str | None = Field(default=None, max_length=200)
    compliance_officer_username: str | None = Field(default=None, max_length=200)

    # Deployment context captured at registration. deployment_country is ISO
    # 3166-1 alpha-2.
    deployment_country: str | None = Field(default=None, max_length=2)

    # Optional descriptive fields (populated by the AI-assisted flow; manual owner
    # mode omits them and the intake stays a minimal stub).
    intended_purpose: str | None = None
    department: str | None = None
    use_case: str | None = None
    people_affected: str | None = None
    decision_context: str | None = None
    autonomy_level: str | None = None

    # Optional classifier flags — when any are present, intake runs classify().
    subliminal_manipulation: bool | None = None
    exploits_vulnerability: bool | None = None
    social_scoring_public: bool | None = None
    real_time_biometric_public: bool | None = None
    emotion_recognition_workplace: bool | None = None
    untargeted_facial_scraping: bool | None = None
    predictive_policing: bool | None = None
    biometric_categorisation_sensitive: bool | None = None
    is_biometric_identification: bool | None = None
    is_critical_infrastructure: bool | None = None
    is_education_related: bool | None = None
    is_employment_related: bool | None = None
    is_credit_scoring: bool | None = None
    is_public_service: bool | None = None
    is_law_enforcement: bool | None = None
    is_migration: bool | None = None
    is_judicial_admin: bool | None = None
    is_gpai: bool | None = None
    training_compute_flops: float | None = None
    is_chatbot: bool | None = None
    generates_synthetic_content: bool | None = None

    classification_rationale: list[RationaleItem] | ClassificationRationale | None = (
        None
    )

    # Owner of the system is its creator (set server-side at intake). contributors is
    # a roster of usernames designated to support the registration.
    business_owners: str | None = None
    contributors: list[str] | None = None
    git_repo_url: str | None = Field(default=None, max_length=500)
    planned_rollout_date: date | None = None

    registration_mode: Literal["ai", "manual_questionnaire", "full_manual"] = "ai"
    org_role: str = "provider"
    # Full-manual override: creator supplies the tier directly (validated against VALID_TIERS
    # in the router) and names the compliance officer.
    tier: str | None = None

    business_assignee_username: str | None = None
    technical_assignee_username: str | None = None
    questionnaire_answers: dict | None = None

    @field_validator("name")
    @classmethod
    def name_not_whitespace(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("name must not be blank")
        return v

    @field_validator("org_role")
    @classmethod
    def org_role_valid(cls, v: str) -> str:
        if v not in VALID_ROLES:
            raise ValueError(f"org_role must be one of {sorted(VALID_ROLES)}")
        return v

    @field_validator(
        "assignee_username",
        "compliance_officer_username",
        "business_assignee_username",
        "technical_assignee_username",
        mode="before",
    )
    @classmethod
    def blank_username_to_none(cls, v):
        """Coerce ""/whitespace → None. A falsy-but-present username would otherwise
        slip past the ``row.assignee_username and ...`` edit guard in update_system,
        letting anyone edit the system."""
        if isinstance(v, str):
            v = v.strip()
        return v or None


class AISystemUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    version: str | None = Field(default=None, max_length=50)
    provider: str | None = None
    org_name: str | None = None
    org_role: str | None = None
    description: str | None = None
    intended_purpose: str | None = None
    department: str | None = None
    use_case: str | None = None
    people_affected: str | None = None
    decision_context: str | None = None
    system_type: str | None = None
    autonomy_level: str | None = None
    provider_country: str | None = Field(default=None, max_length=5)
    deployment_country: str | None = Field(default=None, max_length=2)
    lifecycle: str | None = None
    business_owners: str | None = None
    contributors: list[str] | None = None
    git_repo_url: str | None = Field(default=None, max_length=500)
    planned_rollout_date: date | None = None

    # Risk flags (editable in draft/rejected)
    subliminal_manipulation: bool | None = None
    exploits_vulnerability: bool | None = None
    social_scoring_public: bool | None = None
    real_time_biometric_public: bool | None = None
    emotion_recognition_workplace: bool | None = None
    untargeted_facial_scraping: bool | None = None
    predictive_policing: bool | None = None
    biometric_categorisation_sensitive: bool | None = None
    is_biometric_identification: bool | None = None
    is_critical_infrastructure: bool | None = None
    is_education_related: bool | None = None
    is_employment_related: bool | None = None
    is_credit_scoring: bool | None = None
    is_public_service: bool | None = None
    is_law_enforcement: bool | None = None
    is_migration: bool | None = None
    is_judicial_admin: bool | None = None
    is_gpai: bool | None = None
    training_compute_flops: float | None = None
    is_chatbot: bool | None = None
    generates_synthetic_content: bool | None = None

    @field_validator("name")
    @classmethod
    def name_not_whitespace(cls, v: str | None) -> str | None:
        if v is not None and not v.strip():
            raise ValueError("name must not be blank")
        return v

    @field_validator("org_role")
    @classmethod
    def org_role_valid(cls, v: str | None) -> str | None:
        if v is not None and v not in VALID_ROLES:
            raise ValueError(f"org_role must be one of {sorted(VALID_ROLES)}")
        return v


class ClassificationResult(BaseModel):
    tier: str
    basis: str
    obligations: list[str]
    annex_iii_area: int | None = Field(default=None, ge=1, le=8)


class AISystemResponse(BaseModel):
    id: str
    name: str
    version: str
    provider: str
    org_name: str
    org_role: str
    description: str
    intended_purpose: str
    department: str | None
    use_case: str | None
    people_affected: str | None
    decision_context: str | None
    system_type: str
    autonomy_level: str
    provider_country: str
    deployment_country: str | None
    tier: str
    basis: str
    annex_iii_area: int | None
    classification_rationale: list[RationaleItem] | ClassificationRationale | None
    field_confirmations: dict[str, bool] | None
    lifecycle: str
    compliance: float
    subliminal_manipulation: bool
    exploits_vulnerability: bool
    social_scoring_public: bool
    real_time_biometric_public: bool
    emotion_recognition_workplace: bool
    untargeted_facial_scraping: bool
    predictive_policing: bool
    biometric_categorisation_sensitive: bool
    is_biometric_identification: bool
    is_critical_infrastructure: bool
    is_education_related: bool
    is_employment_related: bool
    is_credit_scoring: bool
    is_public_service: bool
    is_law_enforcement: bool
    is_migration: bool
    is_judicial_admin: bool
    is_gpai: bool
    training_compute_flops: float
    is_chatbot: bool
    generates_synthetic_content: bool
    created_at: datetime
    updated_at: datetime
    workflow_status: str
    registration_mode: str
    assignee_username: str | None
    compliance_officer_username: str | None
    business_assignee_username: str | None
    technical_assignee_username: str | None
    info_requested_section: str | None = None
    questionnaire_answers: dict | None
    registration_documents: list[RegistrationDocument] | None = None
    business_owners: str | None = None
    contributors: list[str] | None = None
    git_repo_url: str | None = None
    planned_rollout_date: date | None = None

    model_config = {"from_attributes": True}


class IntakeResponse(BaseModel):
    system: AISystemResponse
    classification: ClassificationResult


# ---------------------------------------------------------------------------
# Batch import
# ---------------------------------------------------------------------------


class AISystemImport(BaseModel):
    """One record in a batch-import payload (POST /v1/intake/batch).

    Carries all data columns of ai_systems — descriptive fields, classification
    result, and classifier flags.  Policy fields (assignees, registration_mode,
    workflow_status) are NOT accepted here; they are set at import time.
    The four JSONB audit/workflow fields (classification_rationale,
    field_confirmations, questionnaire_answers, registration_documents) are never
    imported — always stored as NULL.
    Currently this schema is a for a bulk upload of testing data.
    ponytail: insert-only, no dedup — duplicates on re-import by design.
    See docs/batch-import-format.md for the upgrade path.
    """

    model_config = {"extra": "ignore"}

    # --- Descriptive (only name is required) ---
    name: str = Field(..., min_length=1, max_length=200)
    version: str | None = Field(default=None, max_length=50)
    provider: str | None = Field(default=None, max_length=200)
    org_name: str | None = Field(default=None, max_length=200)
    org_role: str = Field(default="provider", max_length=30)
    description: str | None = None
    intended_purpose: str | None = None
    department: str | None = None
    use_case: str | None = None
    people_affected: str | None = None
    decision_context: str | None = None
    system_type: str | None = Field(default=None, max_length=30)
    autonomy_level: str | None = Field(default=None, max_length=50)
    application_url: str | None = Field(default=None, max_length=500)
    provider_country: str | None = Field(default=None, max_length=5)
    deployment_country: str | None = Field(default=None, max_length=2)
    eu_output_usage: bool | None = None
    eu_market_placement: bool | None = None
    lifecycle: str | None = Field(default=None, max_length=30)
    business_owners: str | None = None
    technical_owners: str | None = None
    git_repo_url: str | None = Field(default=None, max_length=500)

    # --- Classification result (tier is authoritative from source; classify() does not run) ---
    tier: str | None = None
    basis: str | None = None
    annex_iii_area: int | None = Field(default=None, ge=1, le=8)

    # --- Classifier flags (evidential only) ---
    subliminal_manipulation: bool | None = None
    exploits_vulnerability: bool | None = None
    social_scoring_public: bool | None = None
    real_time_biometric_public: bool | None = None
    emotion_recognition_workplace: bool | None = None
    untargeted_facial_scraping: bool | None = None
    predictive_policing: bool | None = None
    biometric_categorisation_sensitive: bool | None = None
    is_biometric_identification: bool | None = None
    is_critical_infrastructure: bool | None = None
    is_education_related: bool | None = None
    is_employment_related: bool | None = None
    is_credit_scoring: bool | None = None
    is_public_service: bool | None = None
    is_law_enforcement: bool | None = None
    is_migration: bool | None = None
    is_judicial_admin: bool | None = None
    is_gpai: bool | None = None
    training_compute_flops: float | None = Field(
        default=None, ge=0, allow_inf_nan=False
    )
    is_chatbot: bool | None = None
    generates_synthetic_content: bool | None = None

    @field_validator("name")
    @classmethod
    def name_not_whitespace(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("name must not be blank")
        return v

    @field_validator("org_role")
    @classmethod
    def org_role_valid(cls, v: str) -> str:
        if v not in VALID_ROLES:
            raise ValueError(f"org_role must be one of {sorted(VALID_ROLES)}")
        return v

    @field_validator("tier")
    @classmethod
    def tier_valid(cls, v: str | None) -> str | None:
        if v is not None and v not in VALID_TIERS:
            raise ValueError(f"tier must be one of {sorted(VALID_TIERS)}")
        return v

    @field_validator("lifecycle")
    @classmethod
    def lifecycle_valid(cls, v: str | None) -> str | None:
        if v is not None and v not in VALID_LIFECYCLES:
            raise ValueError(f"lifecycle must be one of {sorted(VALID_LIFECYCLES)}")
        return v

    @field_validator("application_url")
    @classmethod
    def url_scheme_allowlist(cls, v: str | None) -> str | None:
        """Reject non-http(s) schemes — application_url is rendered as <a href> in the UI."""
        if v and urlparse(v).scheme not in ("http", "https"):
            raise ValueError("application_url must use http or https")
        return v

    @field_validator("git_repo_url")
    @classmethod
    def git_repo_url_scheme_allowlist(cls, v: str | None) -> str | None:
        """Reject unexpected schemes — git_repo_url is rendered as a link in the UI."""
        if v and urlparse(v).scheme not in ("http", "https", "git", "ssh"):
            raise ValueError("git_repo_url must use http, https, git, or ssh")
        return v


class ImportFailure(BaseModel):
    index: int
    name: str | None = None
    error: str


class ImportResult(BaseModel):
    imported: int
    failed: list[ImportFailure]


class FieldConfirmationPatch(BaseModel):
    """Partial field-confirmation update — only the keys sent are merged into field_confirmations."""

    confirmations: dict[str, bool]


class QuestionnaireAnswersPatch(BaseModel):
    """Merge-patch update for questionnaire answers.

    ``section="business"`` merges into the top level of ``questionnaire_answers``;
    ``section="technical"`` merges into the nested ``"technical"`` sub-object (kept
    separate so the AI-mode flag-inference prompt can read the two sets apart)."""

    answers: dict[str, str]
    section: Literal["business", "technical"] = "business"


# ---------------------------------------------------------------------------
# Side-effect-free classification evaluate (Test Bed)
# ---------------------------------------------------------------------------


class EvaluateAnswers(BaseModel):
    """Business + technical free-text answers for the evaluate endpoint."""

    business: dict[str, str] = Field(default_factory=dict)
    technical: dict[str, str] = Field(default_factory=dict)


class EvaluateRequest(BaseModel):
    """Request body for POST /v1/classify/evaluate."""

    answers: EvaluateAnswers
    enabled_sources: dict[str, bool] = Field(default_factory=dict)
    injected_context: str = ""
    prompt_override: str | None = None
    model: str | None = None
    role: str | None = (
        None  # "engineer" | "compliance_officer" — adds role-specific prompt framing
    )


class EvaluateResponse(BaseModel):
    """Response from POST /v1/classify/evaluate."""

    tier: str
    basis: str
    obligations: list[str]
    confidence: float | None
    rationale: dict
