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
