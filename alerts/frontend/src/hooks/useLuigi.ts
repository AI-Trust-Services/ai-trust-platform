import { useEffect } from "react";
import LuigiClient from "@luigi-project/client";

export function useLuigiInit(onInit: (ctx: unknown) => void) {
  useEffect(() => {
    const id = LuigiClient.addInitListener((ctx: unknown) => onInit(ctx));
    return () => LuigiClient.removeInitListener(id);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}

export function navigateTo(path: string, fallbackUrl: string) {
  try {
    LuigiClient.linkManager().navigate(path);
  } catch {
    window.location.href = fallbackUrl;
  }
}
