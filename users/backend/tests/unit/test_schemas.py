"""Unit tests for users backend Pydantic schemas."""
from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.schemas import InviteUserRequest, UpdateUserRequest, UserSummary


# --- InviteUserRequest ---

def test_invite_valid_minimal():
    r = InviteUserRequest(username="alice", email="alice@example.com",
                          firstName="Alice", lastName="Smith",
                          temporaryPassword="secret123")
    assert r.username == "alice"
    assert r.email == "alice@example.com"
    assert r.department == ""


def test_invite_rejects_invalid_email():
    with pytest.raises(ValidationError):
        InviteUserRequest(username="alice", email="not-an-email",
                          firstName="Alice", lastName="Smith",
                          temporaryPassword="x")


def test_invite_requires_username():
    with pytest.raises(ValidationError):
        InviteUserRequest(email="alice@example.com", firstName="Alice",
                          lastName="Smith", temporaryPassword="x")


def test_invite_requires_temporary_password():
    with pytest.raises(ValidationError):
        InviteUserRequest(username="alice", email="alice@example.com",
                          firstName="Alice", lastName="Smith")


def test_invite_optional_fields_default_empty():
    r = InviteUserRequest(username="bob", email="bob@example.com",
                          firstName="Bob", lastName="Jones",
                          temporaryPassword="pw")
    assert r.department == ""
    assert r.businessUnit == ""
    assert r.jobTitle == ""
    assert r.phone == ""
    assert r.preferredLanguage == ""


# --- UpdateUserRequest ---

def test_update_all_none_is_valid():
    u = UpdateUserRequest()
    assert u.firstName is None
    assert u.email is None


def test_update_partial_fields():
    u = UpdateUserRequest(firstName="NewName", department="Engineering")
    assert u.firstName == "NewName"
    assert u.department == "Engineering"
    assert u.lastName is None


def test_update_rejects_invalid_email():
    with pytest.raises(ValidationError):
        UpdateUserRequest(email="bad-email")


def test_update_valid_email():
    u = UpdateUserRequest(email="valid@example.com")
    assert str(u.email) == "valid@example.com"


# --- UserSummary ---

def test_user_summary_defaults():
    u = UserSummary(id="abc", username="u", email="u@x.com",
                    firstName="U", lastName="U", enabled=True, emailVerified=False)
    assert u.roles == []
    assert u.createdTimestamp is None
