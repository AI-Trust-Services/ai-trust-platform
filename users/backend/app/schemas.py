from __future__ import annotations
from typing import Optional
from pydantic import BaseModel, EmailStr


class UserSummary(BaseModel):
    id: str
    username: str
    email: str
    firstName: str
    lastName: str
    enabled: bool
    emailVerified: bool
    roles: list[str] = []
    createdTimestamp: Optional[int] = None


class UserDetail(UserSummary):
    attributes: dict[str, list[str]] = {}


class InviteUserRequest(BaseModel):
    username: str
    email: EmailStr
    firstName: str
    lastName: str
    department: str = ""
    businessUnit: str = ""
    jobTitle: str = ""
    phone: str = ""
    preferredLanguage: str = ""
    temporaryPassword: str


class UpdateUserRequest(BaseModel):
    firstName: Optional[str] = None
    lastName: Optional[str] = None
    email: Optional[EmailStr] = None
    department: Optional[str] = None
    businessUnit: Optional[str] = None
    jobTitle: Optional[str] = None
    phone: Optional[str] = None
    preferredLanguage: Optional[str] = None


class RoleSummary(BaseModel):
    id: str
    name: str
    description: str = ""


class UsersListResponse(BaseModel):
    total: int
    users: list[UserSummary]


class PermissionsResponse(BaseModel):
    username: str
    permissions: list[str]
