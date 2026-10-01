"""Permission string constants — single source of truth for all permission names.

These strings map to OpenFGA relations on the `platform:global` object.
The relation name in the OpenFGA model is derived by prefixing `can_` and
replacing `:` with `_` — e.g. `systems:read` → `can_read_systems`.
See RELATION_BY_PERMISSION below for the exact mapping.
"""

# Systems
SYSTEMS_READ = "systems:read"
SYSTEMS_WRITE = "systems:write"
SYSTEMS_APPROVE = "systems:approve"

# Assessments
ASSESSMENTS_READ = "assessments:read"
ASSESSMENTS_WRITE = "assessments:write"
ASSESSMENTS_APPROVE = "assessments:approve"

# Evidence
EVIDENCE_READ = "evidence:read"
EVIDENCE_WRITE = "evidence:write"
EVIDENCE_APPROVE = "evidence:approve"

# Alerts
ALERTS_READ = "alerts:read"
ALERTS_HANDLE = "alerts:handle"
ALERTS_MANAGE_RULES = "alerts:manage_rules"

# Monitoring
MONITORING_READ = "monitoring:read"

# IAM
IAM_MANAGE = "iam:manage"

# Audit
AUDIT_READ = "audit:read"

# Risk management — per-role confirmation of a risk entry's required sign-off.
# Each is granted to exactly one role so that only that role can confirm/decline
# the approval required from it (see risk-management/backend/app/routers/risks.py).
RISKS_CONFIRM_ENGINEER = "risks:confirm_engineer"
RISKS_CONFIRM_OFFICER = "risks:confirm_officer"

# All permissions, in matrix order. Used by /me/permissions to enumerate checks.
ALL_PERMISSIONS = [
    SYSTEMS_READ,
    SYSTEMS_WRITE,
    SYSTEMS_APPROVE,
    ASSESSMENTS_READ,
    ASSESSMENTS_WRITE,
    ASSESSMENTS_APPROVE,
    EVIDENCE_READ,
    EVIDENCE_WRITE,
    EVIDENCE_APPROVE,
    ALERTS_READ,
    ALERTS_HANDLE,
    ALERTS_MANAGE_RULES,
    MONITORING_READ,
    IAM_MANAGE,
    AUDIT_READ,
    RISKS_CONFIRM_ENGINEER,
    RISKS_CONFIRM_OFFICER,
]

# Permission string → OpenFGA relation name on platform:global.
RELATION_BY_PERMISSION = {
    SYSTEMS_READ: "can_read_systems",
    SYSTEMS_WRITE: "can_write_systems",
    SYSTEMS_APPROVE: "can_approve_systems",
    ASSESSMENTS_READ: "can_read_assessments",
    ASSESSMENTS_WRITE: "can_write_assessments",
    ASSESSMENTS_APPROVE: "can_approve_assessments",
    EVIDENCE_READ: "can_read_evidence",
    EVIDENCE_WRITE: "can_write_evidence",
    EVIDENCE_APPROVE: "can_approve_evidence",
    ALERTS_READ: "can_read_alerts",
    ALERTS_HANDLE: "can_handle_alerts",
    ALERTS_MANAGE_RULES: "can_manage_alert_rules",
    MONITORING_READ: "can_read_monitoring",
    IAM_MANAGE: "can_manage_iam",
    AUDIT_READ: "can_read_audit",
    RISKS_CONFIRM_ENGINEER: "can_confirm_engineer_risks",
    RISKS_CONFIRM_OFFICER: "can_confirm_officer_risks",
}

# The singleton resource all Phase 2 checks run against.
PLATFORM_OBJECT = "platform:global"

# Built-in roles and the permissions each grants. Seeded by openfga-provision.
ROLE_PERMISSIONS = {
    "platform_administrator": [IAM_MANAGE],
    "ai_engineer": [
        SYSTEMS_READ,
        SYSTEMS_WRITE,
        ASSESSMENTS_READ,
        ASSESSMENTS_WRITE,
        EVIDENCE_READ,
        EVIDENCE_WRITE,
        ALERTS_READ,
        ALERTS_HANDLE,
        MONITORING_READ,
        AUDIT_READ,
        RISKS_CONFIRM_ENGINEER,
    ],
    "ai_compliance_officer": [
        SYSTEMS_READ,
        SYSTEMS_APPROVE,
        ASSESSMENTS_READ,
        ASSESSMENTS_WRITE,
        ASSESSMENTS_APPROVE,
        EVIDENCE_READ,
        EVIDENCE_WRITE,
        EVIDENCE_APPROVE,
        ALERTS_READ,
        ALERTS_HANDLE,
        AUDIT_READ,
        RISKS_CONFIRM_OFFICER,
    ],
    "business_owner": [
        SYSTEMS_READ,
        SYSTEMS_WRITE,
        SYSTEMS_APPROVE,
        ASSESSMENTS_READ,
        ASSESSMENTS_WRITE,
        EVIDENCE_READ,
        EVIDENCE_WRITE,
        EVIDENCE_APPROVE,
        ALERTS_READ,
    ],
    "auditor": [
        SYSTEMS_READ,
        ASSESSMENTS_READ,
        EVIDENCE_READ,
        ALERTS_READ,
        MONITORING_READ,
        AUDIT_READ,
    ],
    "executive": [
        SYSTEMS_READ,
        ASSESSMENTS_READ,
        MONITORING_READ,
    ],
}

BUILT_IN_ROLES = list(ROLE_PERMISSIONS.keys())
