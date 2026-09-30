/**
 * Shared TypeScript types for AI Trust Platform MFEs.
 */

/**
 * Branding configuration from the backend API.
 * Single source of truth — re-exported by admin/frontend/src/types.ts.
 */
export interface Branding {
  org_name: string;
  // Logos
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
  sidebar_text: string | null;
  header_bg: string | null;
  header_text: string | null;
  // Shell colors (dark mode)
  sidebar_bg_dark: string | null;
  sidebar_text_dark: string | null;
  header_bg_dark: string | null;
  header_text_dark: string | null;
  // UI element colors (light mode)
  button_bg: string | null;
  button_text: string | null;
  table_header_bg: string | null;
  table_border: string | null;
  mfe_bg: string | null;
  // UI element colors (dark mode)
  button_bg_dark: string | null;
  button_text_dark: string | null;
  table_header_bg_dark: string | null;
  table_border_dark: string | null;
  mfe_bg_dark: string | null;
  // Advanced colors (tier badges, lifecycle, charts, alerts, etc.)
  advanced_colors?: Record<string, string> | null;
  // Metadata
  published_at?: string | null;
  published_by?: string | null;
}
