export interface SmtpSettings {
  smtp_host: string | null;
  smtp_port: number | null;
  smtp_user: string | null;
  has_password: boolean;
  smtp_from: string | null;
  smtp_from_name: string | null;
  smtp_ssl: boolean;
  smtp_starttls: boolean;
}

export interface SmtpSettingsUpdate {
  smtp_host: string | null;
  smtp_port: number | null;
  smtp_user: string | null;
  smtp_password?: string | null;
  smtp_from: string | null;
  smtp_from_name: string | null;
  smtp_ssl: boolean;
  smtp_starttls: boolean;
}

export interface SmtpTestRequest {
  to: string;
}

export interface SmtpTestResponse {
  success: boolean;
  message: string;
}

export interface GeneralSettings {
  platform_name: string;
  support_email: string | null;
}

export interface GeneralSettingsUpdate {
  platform_name?: string | null;
  support_email?: string | null;
}

export interface AiProviderSettings {
  active_provider: string;
  ollama: Record<string, string | null>;
  external: Record<string, string | null>;
  has_ollama_api_key: boolean;
  has_external_client_secret: boolean;
}

export interface AiProviderUpdate {
  active_provider: string;
  ollama?: Record<string, string | null>;
  external?: Record<string, string | null>;
}

export interface TestConnectionResponse {
  success: boolean;
  message: string;
}

export interface AdminStats {
  user_count: number;
  role_count: number;
  ai_provider_count: number;
  active_provider: string | null;
  mail_configured: boolean;
}
