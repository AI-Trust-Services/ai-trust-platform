"""Tests for Pydantic schema validation."""
from __future__ import annotations

import pytest
from pydantic import ValidationError
from app.schemas import AISystemCreate, AISystemUpdate


# --- AISystemCreate ---

def test_create_valid_minimal():
    s = AISystemCreate(name="My System")
    assert s.name == "My System"
    assert s.is_gpai is False
    assert s.training_compute_flops == 0.0


def test_create_name_required():
    with pytest.raises(ValidationError):
        AISystemCreate()


def test_create_name_empty_string():
    with pytest.raises(ValidationError):
        AISystemCreate(name="")


def test_create_name_whitespace_only():
    with pytest.raises(ValidationError, match="must not be blank"):
        AISystemCreate(name="   ")


def test_create_name_max_length():
    with pytest.raises(ValidationError):
        AISystemCreate(name="x" * 201)


def test_create_flops_negative():
    with pytest.raises(ValidationError):
        AISystemCreate(name="Test", training_compute_flops=-1.0)


def test_create_flops_infinity():
    with pytest.raises(ValidationError, match="finite"):
        AISystemCreate(name="Test", training_compute_flops=float("inf"))


def test_create_flops_nan():
    with pytest.raises(ValidationError):
        AISystemCreate(name="Test", training_compute_flops=float("nan"))


def test_create_flops_zero():
    s = AISystemCreate(name="Test", training_compute_flops=0.0)
    assert s.training_compute_flops == 0.0


def test_create_flops_valid_large():
    s = AISystemCreate(name="Test", training_compute_flops=10**25)
    assert s.training_compute_flops == pytest.approx(10**25)


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
