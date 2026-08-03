"""Schemas for the IAM (role management) API."""
from pydantic import BaseModel


class RoleInfo(BaseModel):
    """A built-in role and the permissions it grants."""

    name: str
    permissions: list[str]


class UserRole(BaseModel):
    """A user and their currently assigned role (or None if unassigned)."""

    username: str
    email: str | None = None
    first_name: str | None = None
    last_name: str | None = None
    enabled: bool = True
    role: str | None = None


class AssignRoleRequest(BaseModel):
    """Body for assigning a role to a user."""

    role: str


class PermissionsResponse(BaseModel):
    """The current user's effective permission list."""

    username: str
    permissions: list[str]
