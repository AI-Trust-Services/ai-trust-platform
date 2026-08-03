import { useEffect } from "react";
import LuigiClient from "@luigi-project/client";

export function useLuigiInit(onInit: (ctx: unknown) => void): void {
  useEffect(() => {
    const id = LuigiClient.addInitListener((ctx) => onInit(ctx));
    return () => { LuigiClient.removeInitListener(id); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}
