"""Unit tests for admin backend Pydantic schemas."""
from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.schemas import (
    GeneralSettingsUpdate,
    SmtpSettingsUpdate,
    SmtpTestRequest,
)


# --- SmtpSettingsUpdate ---

def test_smtp_update_all_defaults():
    s = SmtpSettingsUpdate()
    assert s.smtp_host is None
    assert s.smtp_port is None
    assert s.smtp_user is None
    assert s.smtp_password is None
    assert s.smtp_from is None
    assert s.smtp_from_name is None
    assert s.smtp_ssl is False
    assert s.smtp_starttls is False


def test_smtp_update_full():
    s = SmtpSettingsUpdate(
        smtp_host="smtp.example.com",
        smtp_port=587,
        smtp_user="user@example.com",
        smtp_password="secret",
        smtp_from="noreply@example.com",
        smtp_from_name="AI Trust Platform",
        smtp_ssl=False,
        smtp_starttls=True,
    )
    assert s.smtp_host == "smtp.example.com"
    assert s.smtp_port == 587
    assert s.smtp_starttls is True


def test_smtp_update_ssl_and_starttls_are_bool():
    s = SmtpSettingsUpdate(smtp_ssl=True, smtp_starttls=False)
    assert s.smtp_ssl is True
    assert s.smtp_starttls is False


# --- SmtpTestRequest ---

def test_smtp_test_valid_email():
    r = SmtpTestRequest(to="admin@local.dev")
    assert str(r.to) == "admin@local.dev"


def test_smtp_test_rejects_invalid_email():
    with pytest.raises(ValidationError):
        SmtpTestRequest(to="not-an-email")


def test_smtp_test_requires_to():
    with pytest.raises(ValidationError):
        SmtpTestRequest()


# --- GeneralSettingsUpdate ---

def test_general_settings_all_optional():
    g = GeneralSettingsUpdate()
    assert g.platform_name is None
    assert g.support_email is None


def test_general_settings_with_values():
    g = GeneralSettingsUpdate(platform_name="My Platform", support_email="support@example.com")
    assert g.platform_name == "My Platform"
    assert g.support_email == "support@example.com"


def test_general_settings_empty_strings_allowed():
    g = GeneralSettingsUpdate(platform_name="", support_email="")
    assert g.platform_name == ""
