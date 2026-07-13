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
