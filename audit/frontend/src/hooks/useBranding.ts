import { useEffect } from 'react';

const BRANDING_KEY = 'trust-platform-branding';
const BRANDING_STYLE_ID = 'branding-overrides';
const THEME_KEY = 'trust-platform-theme';

interface Branding {
  org_name: string;
  // Brand colors
  primary_color: string | null;
  secondary_color: string | null;
  accent_color: string | null;
  warning_color: string | null;
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
}

/**
 * Applies custom branding colors from localStorage to CSS variables and rules.
 * The shell fetches branding from the backend and stores it in localStorage;
 * MFEs listen for changes and apply the colors.
 */
export function useBranding(): void {
  useEffect(() => {
    function apply() {
      const raw = localStorage.getItem(BRANDING_KEY);
      if (!raw) {
        // Remove any existing branding overrides
        document.getElementById(BRANDING_STYLE_ID)?.remove();
        return;
      }

      try {
        const b: Branding = JSON.parse(raw);
        const root = document.documentElement;
        const isDark = localStorage.getItem(THEME_KEY) === 'dark' || root.classList.contains('dark');

        // Set CSS variables for brand colors
        if (b.primary_color) {
          root.style.setProperty('--primary', b.primary_color);
          root.style.setProperty('--brand', b.primary_color);
        }
        if (b.secondary_color) {
          root.style.setProperty('--secondary', b.secondary_color);
        }
        if (b.accent_color) {
          root.style.setProperty('--accent', b.accent_color);
        }
        if (b.warning_color) {
          root.style.setProperty('--warning', b.warning_color);
          root.style.setProperty('--destructive', b.warning_color);
        }

        // Build CSS rules for buttons and tables
        // Use theme-appropriate colors
        const btnBg = isDark ? (b.button_bg_dark || b.button_bg) : b.button_bg;
        const btnText = isDark ? (b.button_text_dark || b.button_text) : b.button_text;
        const tableHeaderBg = isDark ? (b.table_header_bg_dark || b.table_header_bg) : b.table_header_bg;
        const tableBorder = isDark ? (b.table_border_dark || b.table_border) : b.table_border;

        let css = '';

        // Button styling - target shadcn button variants
        if (btnBg || btnText) {
          const bg = btnBg || 'var(--primary)';
          const text = btnText || '#ffffff';
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
