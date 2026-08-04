"""Permission string constants — single source of truth for all permission names.

These strings map to OpenFGA relations on the `platform:global` object.
The relation name in the OpenFGA model is derived by prefixing `can_` and
replacing `:` with `_` — e.g. `systems:read` → `can_read_systems`.
See RELATION_BY_PERMISSION below for the exact mapping.
"""

# Systems
SYSTEMS_READ = "systems:read"
SYSTEMS_WRITE = "systems:write"

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

# All permissions, in matrix order. Used by /me/permissions to enumerate checks.
ALL_PERMISSIONS = [
    SYSTEMS_READ,
    SYSTEMS_WRITE,
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
]

# Permission string → OpenFGA relation name on platform:global.
RELATION_BY_PERMISSION = {
    SYSTEMS_READ: "can_read_systems",
    SYSTEMS_WRITE: "can_write_systems",
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
}

# The singleton resource all Phase 2 checks run against.
PLATFORM_OBJECT = "platform:global"

# Built-in roles and the permissions each grants. Seeded by openfga-provision.
ROLE_PERMISSIONS = {
    "platform_administrator": ALL_PERMISSIONS,
    "ai_engineer": [
        SYSTEMS_READ, SYSTEMS_WRITE,
        ASSESSMENTS_READ,
        EVIDENCE_READ, EVIDENCE_WRITE,
        ALERTS_READ, ALERTS_HANDLE,
        MONITORING_READ,
    ],
    "ai_compliance_officer": [
        SYSTEMS_READ,
        ASSESSMENTS_READ, ASSESSMENTS_WRITE,
        EVIDENCE_READ, EVIDENCE_WRITE, EVIDENCE_APPROVE,
        ALERTS_READ, ALERTS_HANDLE,
    ],
    "business_owner": [
        SYSTEMS_READ,
        ASSESSMENTS_READ, ASSESSMENTS_APPROVE,
        EVIDENCE_READ, EVIDENCE_APPROVE,
        ALERTS_READ,
    ],
    "auditor": [
        SYSTEMS_READ,
        ASSESSMENTS_READ,
        EVIDENCE_READ,
        ALERTS_READ,
        MONITORING_READ,
    ],
    "executive": [
        SYSTEMS_READ,
        ASSESSMENTS_READ,
        MONITORING_READ,
    ],
}

BUILT_IN_ROLES = list(ROLE_PERMISSIONS.keys())
