import { useEffect, useCallback } from "react";
import LuigiClient from "@luigi-project/client";

export function useLuigiInit(onInit: (ctx: unknown) => void): void {
  useEffect(() => {
    const id = LuigiClient.addInitListener((ctx) => onInit(ctx));
    return () => { LuigiClient.removeInitListener(id); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}

/**
 * Syncs dark mode class with the parent shell.
 * The shell sets html.dark and sends a custom message to MFEs.
 * Also checks on load by looking at the parent's html element.
 */
export function useLuigiThemeSync(): void {
  useEffect(() => {
    // Check parent's theme on init
    const syncFromParent = () => {
      try {
        const parentHtml = window.parent?.document?.documentElement;
        if (parentHtml) {
          const isDark = parentHtml.classList.contains("dark");
          document.documentElement.classList.toggle("dark", isDark);
        }
      } catch {
        // Cross-origin - can't access parent, fall back to message listener
      }
    };

    // Initial sync
    syncFromParent();

    // Listen for theme change messages from shell
    const listenerId = LuigiClient.addCustomMessageListener("theme-changed", (msg: { theme?: string }) => {
      const isDark = msg.theme === "dark";
      document.documentElement.classList.toggle("dark", isDark);
    });

    // Also observe parent's html class changes if same-origin
    let observer: MutationObserver | null = null;
    try {
      const parentHtml = window.parent?.document?.documentElement;
      if (parentHtml && parentHtml !== document.documentElement) {
        observer = new MutationObserver(() => syncFromParent());
        observer.observe(parentHtml, { attributes: true, attributeFilter: ["class"] });
      }
    } catch {
      // Cross-origin, rely on custom messages
    }

    return () => {
      LuigiClient.removeCustomMessageListener(listenerId);
      observer?.disconnect();
    };
  }, []);
}

/**
 * Navigate to another MFE using Luigi's linkManager.
 * Use this instead of target="_top" links to avoid sandbox restrictions.
 */
export function navigateToPath(path: string): void {
  try {
    // Use absolute path from root (no context modifier)
    LuigiClient.linkManager().navigate(path);
  } catch {
    // Fallback for non-Luigi context (e.g., standalone dev)
    window.top?.location.assign(window.location.origin + "/#" + path);
  }
}

/**
 * Hook that returns a navigation function for cross-MFE links.
 */
export function useLuigiNavigation() {
  const navigate = useCallback((path: string) => {
    navigateToPath(path);
  }, []);

  return { navigate };
}
