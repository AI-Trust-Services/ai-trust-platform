"""Tests for Pydantic schema validation."""
from __future__ import annotations

import pytest
from pydantic import ValidationError
from app.schemas import AISystemCreate, AISystemUpdate


# --- AISystemCreate ---

def test_create_valid_minimal():
    s = AISystemCreate(name="My System", assignee_username="eng1")
    assert s.name == "My System"
    assert s.description == ""
    assert s.assignee_username == "eng1"
    assert s.compliance_officer_username is None


def test_create_name_required():
    with pytest.raises(ValidationError):
        AISystemCreate(assignee_username="eng1")


def test_create_name_empty_string():
    with pytest.raises(ValidationError):
        AISystemCreate(name="", assignee_username="eng1")


def test_create_name_whitespace_only():
    with pytest.raises(ValidationError, match="must not be blank"):
        AISystemCreate(name="   ", assignee_username="eng1")


def test_create_name_max_length():
    with pytest.raises(ValidationError):
        AISystemCreate(name="x" * 201, assignee_username="eng1")


def test_create_assignee_required():
    with pytest.raises(ValidationError):
        AISystemCreate(name="Test")


def test_create_assignee_empty_string():
    with pytest.raises(ValidationError):
        AISystemCreate(name="Test", assignee_username="")


# --- AISystemUpdate ---

def test_update_all_none_is_valid():
    u = AISystemUpdate()
    assert u.name is None
    assert u.lifecycle is None


def test_update_name_whitespace_only():
    with pytest.raises(ValidationError, match="must not be blank"):
        AISystemUpdate(name="   ")


def test_update_name_empty_string():
    with pytest.raises(ValidationError):
        AISystemUpdate(name="")


def test_update_name_valid():
    u = AISystemUpdate(name="Updated Name")
    assert u.name == "Updated Name"


def test_update_name_max_length():
    with pytest.raises(ValidationError):
        AISystemUpdate(name="x" * 201)


def test_update_version_max_length():
    with pytest.raises(ValidationError):
        AISystemUpdate(version="x" * 51)


def test_update_application_url_max_length():
    with pytest.raises(ValidationError):
        AISystemUpdate(application_url="http://" + "x" * 500)


def test_update_provider_country_max_length():
    with pytest.raises(ValidationError):
        AISystemUpdate(provider_country="TOOLONG")
