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

export interface AdminStats {
  user_count: number;
  role_count: number;
  mail_configured: boolean;
}

// ── Branding types ───────────────────────────────────────────────────────────

export interface Branding {
  org_name: string;  // Derived from platform_name in Settings
  logo_horizontal_light: string | null;
  logo_horizontal_dark: string | null;
  logo_icon: string | null;
  favicon: string | null;
  // Brand colors (light mode)
  primary_color: string | null;
  secondary_color: string | null;
  accent_color: string | null;
  warning_color: string | null;
  // Brand colors (dark mode)
  primary_color_dark: string | null;
  secondary_color_dark: string | null;
  accent_color_dark: string | null;
  warning_color_dark: string | null;
  // Shell colors (light mode)
  sidebar_bg: string | null;
  header_bg: string | null;
  // Shell colors (dark mode)
  sidebar_bg_dark: string | null;
  header_bg_dark: string | null;
  // UI element colors (light mode)
  button_bg: string | null;
  button_text: string | null;
  table_header_bg: string | null;
  table_border: string | null;
  // UI element colors (dark mode)
  button_bg_dark: string | null;
  button_text_dark: string | null;
  table_header_bg_dark: string | null;
  table_border_dark: string | null;
  // Metadata
  published_at: string | null;
  published_by: string | null;
}

export interface BrandingUpdate {
  // Brand colors (light mode)
  primary_color?: string | null;
  secondary_color?: string | null;
  accent_color?: string | null;
  warning_color?: string | null;
  // Brand colors (dark mode)
  primary_color_dark?: string | null;
  secondary_color_dark?: string | null;
  accent_color_dark?: string | null;
  warning_color_dark?: string | null;
  // Shell colors (light mode)
  sidebar_bg?: string | null;
  header_bg?: string | null;
  // Shell colors (dark mode)
  sidebar_bg_dark?: string | null;
  header_bg_dark?: string | null;
  // UI element colors (light mode)
  button_bg?: string | null;
  button_text?: string | null;
  table_header_bg?: string | null;
  table_border?: string | null;
  // UI element colors (dark mode)
  button_bg_dark?: string | null;
  button_text_dark?: string | null;
  table_header_bg_dark?: string | null;
  table_border_dark?: string | null;
}

export interface BrandingStatus {
  has_unpublished_changes: boolean;
  published_at: string | null;
  published_by: string | null;
}

export interface BrandingPublishResponse {
  success: boolean;
  published_at: string;
  published_by: string;
}
