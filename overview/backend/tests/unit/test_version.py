"""Unit tests for version info parsing — pure function, no k8s I/O."""
import pytest
from app.routers.version import parse_version_info


def _condition(status: str, reason: str, message: str = "") -> dict:
    return {"type": "Ready", "status": status, "reason": reason, "message": message}


# ---------------------------------------------------------------------------
# SHA extraction from lastAttemptedRevision
# ---------------------------------------------------------------------------

def test_sha_extracted_from_last_attempted_revision():
    result = parse_version_info(
        conditions=[_condition("True", "UpgradeSucceeded")],
        last_revision="0.0.0-ai-trust-main-8e3f9ca258d3+1d5d77e39879",
    )
    assert result["sha"] == "8e3f9ca258d3"


def test_sha_unknown_when_revision_missing():
    result = parse_version_info(conditions=[], last_revision=None)
    assert result["sha"] == "unknown"


# ---------------------------------------------------------------------------
# Status mapping
# ---------------------------------------------------------------------------

def test_status_ready_on_upgrade_succeeded():
    result = parse_version_info(
        conditions=[_condition("True", "UpgradeSucceeded", "Helm upgrade succeeded")],
        last_revision="0.0.0-ai-trust-main-abc123+xyz",
    )
    assert result["status"] == "ready"
    assert result["message"] == "Helm upgrade succeeded"


def test_status_failed_on_upgrade_failed():
    result = parse_version_info(
        conditions=[_condition("False", "UpgradeFailed", "Helm upgrade failed")],
        last_revision="0.0.0-ai-trust-main-abc123+xyz",
    )
    assert result["status"] == "failed"


def test_status_failed_on_retries_exceeded():
    result = parse_version_info(
        conditions=[_condition("False", "RetriesExceeded", "Failed after 1 attempt")],
        last_revision="0.0.0-ai-trust-main-abc123+xyz",
    )
    assert result["status"] == "failed"


def test_status_progressing_on_progressing():
    result = parse_version_info(
        conditions=[_condition("Unknown", "Progressing", "Reconciliation in progress")],
        last_revision="0.0.0-ai-trust-main-abc123+xyz",
    )
    assert result["status"] == "progressing"


def test_status_unknown_when_no_conditions():
    result = parse_version_info(conditions=[], last_revision="0.0.0-ai-trust-main-abc123+xyz")
    assert result["status"] == "unknown"
    assert result["message"] == ""
