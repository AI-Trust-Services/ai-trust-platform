import { useEffect, useCallback, useRef } from "react";
import { useLocation } from "react-router";
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

/**
 * Syncs React Router location changes with the Luigi shell URL.
 *
 * With virtualTree: true enabled on the Luigi node, the shell accepts any
 * sub-path and passes it to the MFE. This hook keeps the browser URL in sync
 * with the MFE's internal navigation state.
 *
 * The Luigi shell uses paths like /home/systems, and the MFE uses paths like /systems.
 * This hook maps MFE paths to Luigi shell paths.
 */
export function useLuigiUrlSync(): void {
  const location = useLocation();
  const lastSyncedPath = useRef<string>("");

  useEffect(() => {
    // Build the full MFE path including search params
    const mfePath = location.pathname + location.search;

    // Skip if we already synced this exact path (prevents loops)
    if (mfePath === lastSyncedPath.current) {
      return;
    }

    // Map MFE path to Luigi shell path
    // MFE: /systems/SYS-123 → Luigi: /home/systems/SYS-123
    // MFE: /today → Luigi: /home/today
    const luigiPath = "/home" + mfePath;
    const newHash = "#" + luigiPath;

    // Only update if we're in an iframe (Luigi context)
    if (window.parent && window.parent !== window) {
      try {
        const currentHash = window.parent.location.hash;
        // Only update if the hash actually differs
        if (currentHash !== newHash) {
          lastSyncedPath.current = mfePath;
          // Update URL without triggering navigation - just cosmetic
          window.parent.history.replaceState(
            window.parent.history.state,
            "",
            newHash
          );
        }
      } catch {
        // Cross-origin iframe - can't access parent, silently ignore
      }
    }
  }, [location.pathname, location.search]);
}
