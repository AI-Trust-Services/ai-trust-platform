import { useEffect } from 'react';
import type { Branding } from './types';

const BRANDING_KEY = 'trust-platform-branding';
const BRANDING_STYLE_ID = 'branding-overrides';
const THEME_KEY = 'trust-platform-theme';

const BRANDING_CSS_VARS = [
  '--primary', '--brand', '--secondary', '--accent', '--warning', '--destructive', '--background'
];

// Validates that a value is a CSS hex color before it can be interpolated into a <style> tag.
// Accepts #RGB, #RRGGBB, #RRGGBBAA only — rejects anything else (including CSS injection attempts).
const HEX_COLOR = /^#[0-9a-fA-F]{3}$|^#[0-9a-fA-F]{6}$|^#[0-9a-fA-F]{8}$/;
function safeColor(v: string | null | undefined): string | null {
  return v && HEX_COLOR.test(v) ? v : null;
}

/**
 * Applies custom branding colors from localStorage to CSS variables and rules.
 * The shell fetches branding from the backend and stores it in localStorage;
 * MFEs listen for changes and apply the colors.
 */
export function useBranding(): void {
  useEffect(() => {

    function clearBranding() {
      // Remove the style element
      document.getElementById(BRANDING_STYLE_ID)?.remove();
      // Clear any inline CSS variables set on :root
      const root = document.documentElement;
      for (const v of BRANDING_CSS_VARS) {
        root.style.removeProperty(v);
      }
      // Reset background colors
      root.style.backgroundColor = '';
      document.body.style.backgroundColor = '';
    }

    function apply() {
      const raw = localStorage.getItem(BRANDING_KEY);
      if (!raw) {
        clearBranding();
        return;
      }

      try {
        clearBranding();  // wipe previous inline styles before reapplying
        const b: Branding = JSON.parse(raw);
        const root = document.documentElement;
        const isDark = localStorage.getItem(THEME_KEY) === 'dark' || root.classList.contains('dark');

        // Set CSS variables for brand colors (theme-aware, validated)
        const primaryColor = safeColor(isDark ? (b.primary_color_dark || b.primary_color) : b.primary_color);
        const secondaryColor = safeColor(isDark ? (b.secondary_color_dark || b.secondary_color) : b.secondary_color);
        const accentColor = safeColor(isDark ? (b.accent_color_dark || b.accent_color) : b.accent_color);
        const warningColor = safeColor(isDark ? (b.warning_color_dark || b.warning_color) : b.warning_color);

        if (primaryColor) {
          root.style.setProperty('--primary', primaryColor);
          root.style.setProperty('--brand', primaryColor);
        }
        if (secondaryColor) {
          root.style.setProperty('--secondary', secondaryColor);
        }
        if (accentColor) {
          root.style.setProperty('--accent', accentColor);
        }
        if (warningColor) {
          root.style.setProperty('--warning', warningColor);
          root.style.setProperty('--destructive', warningColor);
        }

        // Apply MFE background color (this is the content area background)
        const mfeBg = safeColor(isDark ? (b.mfe_bg_dark || b.mfe_bg) : b.mfe_bg);
        if (mfeBg) {
          root.style.setProperty('--background', mfeBg);
          root.style.backgroundColor = mfeBg;
          document.body.style.backgroundColor = mfeBg;
        }

        // Build CSS rules for buttons and tables (values validated above via safeColor)
        const btnBg = safeColor(isDark ? (b.button_bg_dark || b.button_bg) : b.button_bg);
        const btnText = safeColor(isDark ? (b.button_text_dark || b.button_text) : b.button_text);
        const tableHeaderBg = safeColor(isDark ? (b.table_header_bg_dark || b.table_header_bg) : b.table_header_bg);
        const tableBorder = safeColor(isDark ? (b.table_border_dark || b.table_border) : b.table_border);

        let css = '';

        // MFE background - ensure it applies to html and body
        if (mfeBg) {
          css += `
            html, body, #root, .min-h-screen {
              background-color: ${mfeBg} !important;
            }
          `;
        }

        // Button styling - target shadcn button variants
        if (btnBg || btnText) {
          const bg = btnBg ?? 'var(--primary)';
          const text = btnText ?? '#ffffff';
          css += `
            /* Primary buttons */
            .bg-primary,
            button[class*="bg-primary"],
            [data-slot="button"]:not([data-variant]) {
              background-color: ${bg} !important;
              color: ${text} !important;
            }
            .bg-primary:hover,
            button[class*="bg-primary"]:hover {
              background-color: ${bg} !important;
              filter: brightness(0.9);
            }
            /* Button component default variant */
            button.inline-flex.items-center.justify-center:not(.bg-secondary):not(.bg-destructive):not(.bg-transparent):not([variant="outline"]):not([variant="ghost"]):not([variant="link"]) {
              background-color: ${bg} !important;
              color: ${text} !important;
            }
          `;
        }

        // Table styling
        if (tableHeaderBg) {
          css += `
            /* Table headers */
            thead,
            thead tr,
            thead th,
            th,
            .table-header,
            [role="columnheader"],
            tr:first-child th {
              background-color: ${tableHeaderBg} !important;
            }
          `;
        }

        if (tableBorder) {
          css += `
            /* Table borders */
            table,
            th,
            td,
            .border,
            [role="table"],
            [role="row"],
            [role="cell"],
            [role="columnheader"] {
              border-color: ${tableBorder} !important;
            }
          `;
        }

        // Apply or update the style element
        let styleEl = document.getElementById(BRANDING_STYLE_ID) as HTMLStyleElement | null;
        if (css) {
          if (!styleEl) {
            styleEl = document.createElement('style');
            styleEl.id = BRANDING_STYLE_ID;
            document.head.appendChild(styleEl);
          }
          styleEl.textContent = css;
        } else if (styleEl) {
          styleEl.remove();
        }
      } catch {
        // Invalid JSON, ignore
      }
    }

    // Apply on mount
    apply();

    // Listen for branding updates from the shell or other tabs
    function onStorage(e: StorageEvent) {
      if (e.key === BRANDING_KEY || e.key === 'trust-platform-branding-update' || e.key === THEME_KEY) {
        apply();
      }
    }
    window.addEventListener('storage', onStorage);

    // Also listen for theme changes via class mutation on html element
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.attributeName === 'class') {
          apply();
          break;
        }
      }
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

    return () => {
      window.removeEventListener('storage', onStorage);
      observer.disconnect();
    };
  }, []);
}
