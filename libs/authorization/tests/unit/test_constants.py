from ai_trust_authorization.constants import (
    ALL_PERMISSIONS,
    RELATION_BY_PERMISSION,
    ROLE_PERMISSIONS,
    ALERTS_READ,
    ALERTS_HANDLE,
    ALERTS_MANAGE_RULES,
    ASSESSMENTS_READ,
    ASSESSMENTS_WRITE,
    ASSESSMENTS_APPROVE,
    AUDIT_READ,
    EVIDENCE_READ,
    EVIDENCE_WRITE,
    EVIDENCE_APPROVE,
    IAM_MANAGE,
    MONITORING_READ,
    SYSTEMS_READ,
    SYSTEMS_WRITE,
    SYSTEMS_APPROVE,
)


def test_all_permissions_unique():
    assert len(ALL_PERMISSIONS) == len(set(ALL_PERMISSIONS))


def test_relation_by_permission_covers_all():
    assert set(ALL_PERMISSIONS) == set(RELATION_BY_PERMISSION.keys())


def test_relation_values_unique():
    values = list(RELATION_BY_PERMISSION.values())
    assert len(values) == len(set(values))


def test_all_role_permissions_are_known():
    for role, perms in ROLE_PERMISSIONS.items():
        unknown = set(perms) - set(ALL_PERMISSIONS)
        assert not unknown, f"Role '{role}' has unknown permissions: {unknown}"


def test_no_duplicate_permissions_within_role():
    for role, perms in ROLE_PERMISSIONS.items():
        assert len(perms) == len(set(perms)), f"Role '{role}' has duplicate permissions"


def test_platform_administrator_has_all_permissions():
    assert set(ROLE_PERMISSIONS["platform_administrator"]) == set(ALL_PERMISSIONS)


def test_ai_engineer_permissions():
    assert set(ROLE_PERMISSIONS["ai_engineer"]) == {
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
    }


def test_ai_compliance_officer_permissions():
    assert set(ROLE_PERMISSIONS["ai_compliance_officer"]) == {
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
    }


def test_business_owner_permissions():
    assert set(ROLE_PERMISSIONS["business_owner"]) == {
        SYSTEMS_READ,
        SYSTEMS_WRITE,
        SYSTEMS_APPROVE,
        ASSESSMENTS_READ,
        ASSESSMENTS_WRITE,
        EVIDENCE_READ,
        EVIDENCE_WRITE,
        EVIDENCE_APPROVE,
        ALERTS_READ,
    }


def test_auditor_permissions():
    assert set(ROLE_PERMISSIONS["auditor"]) == {
        SYSTEMS_READ,
        ASSESSMENTS_READ,
        EVIDENCE_READ,
        ALERTS_READ,
        MONITORING_READ,
        AUDIT_READ,
    }


def test_executive_permissions():
    assert set(ROLE_PERMISSIONS["executive"]) == {
        SYSTEMS_READ,
        ASSESSMENTS_READ,
        MONITORING_READ,
    }


def test_only_admin_can_manage_rules():
    for role, perms in ROLE_PERMISSIONS.items():
        if role != "platform_administrator":
            assert ALERTS_MANAGE_RULES not in perms, (
                f"Role '{role}' should not have {ALERTS_MANAGE_RULES}"
            )


def test_only_admin_can_manage_iam():
    for role, perms in ROLE_PERMISSIONS.items():
        if role != "platform_administrator":
            assert IAM_MANAGE not in perms, (
                f"Role '{role}' should not have {IAM_MANAGE}"
            )
