from __future__ import annotations

from pydantic import BaseModel, EmailStr


class SmtpSettingsResponse(BaseModel):
    smtp_host: str | None
    smtp_port: int | None
    smtp_user: str | None
    has_password: bool
    smtp_from: str | None
    smtp_from_name: str | None
    smtp_ssl: bool
    smtp_starttls: bool

    model_config = {"from_attributes": True}


class SmtpSettingsUpdate(BaseModel):
    smtp_host: str | None = None
    smtp_port: int | None = None
    smtp_user: str | None = None
    smtp_password: str | None = None
    smtp_from: str | None = None
    smtp_from_name: str | None = None
    smtp_ssl: bool = False
    smtp_starttls: bool = False


class SmtpTestRequest(BaseModel):
    to: EmailStr


class SmtpTestResponse(BaseModel):
    success: bool
    message: str


class GeneralSettingsResponse(BaseModel):
    platform_name: str
    support_email: str | None

    model_config = {"from_attributes": True}


class GeneralSettingsUpdate(BaseModel):
    platform_name: str | None = None
    support_email: str | None = None


class AiProviderSettings(BaseModel):
    active_provider: str
    ollama: dict[str, str | None]
    external: dict[str, str | None]
    has_ollama_api_key: bool
    has_external_client_secret: bool


class AiProviderUpdate(BaseModel):
    active_provider: str
    ollama: dict[str, str | None] | None = None
    external: dict[str, str | None] | None = None


class TestConnectionResponse(BaseModel):
    success: bool
    message: str


class AdminStatsResponse(BaseModel):
    user_count: int
    role_count: int
    ai_provider_count: int
    active_provider: str | None
    mail_configured: bool
