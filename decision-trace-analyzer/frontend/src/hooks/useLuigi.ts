import { useEffect } from "react";
// @luigi-project/client v2 exposes named exports (no default export, unlike the
// v1 API the older MFEs use), so import the whole module as a namespace.
import * as LuigiClient from "@luigi-project/client";

/**
 * Completes the Luigi iframe handshake. Loading the client is not enough —
 * Luigi keeps its "Loading…" spinner up until the MFE calls addInitListener,
 * so this must run once on mount. Mirrors the alerts / ai-system-registry MFEs
 * (imported from the npm package, not a CDN script).
 */
export function useLuigiInit(onInit: (ctx: unknown) => void) {
  useEffect(() => {
    const id = LuigiClient.addInitListener((ctx: unknown) => onInit(ctx));
    // v2's removeInitListener returns a boolean; wrap so the effect cleanup
    // stays void (a returned value would be treated as a Destructor).
    return () => {
      LuigiClient.removeInitListener(id);
    };
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
