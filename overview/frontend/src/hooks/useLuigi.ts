import { useEffect } from "react";
import LuigiClient from "@luigi-project/client";

export function useLuigiInit(onInit: (ctx: unknown) => void): void {
  useEffect(() => {
    const id = LuigiClient.addInitListener((ctx) => onInit(ctx));
    return () => { LuigiClient.removeInitListener(id); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}

export function navigateTo(luigiPath: string, fallbackUrl: string): void {
  try {
    LuigiClient.linkManager().navigate(luigiPath);
  } catch {
    window.location.href = fallbackUrl;
  }
}
