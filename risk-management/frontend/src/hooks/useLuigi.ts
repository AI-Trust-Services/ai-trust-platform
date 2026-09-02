import { useEffect } from "react";
import LuigiClient from "@luigi-project/client";

export function useLuigi() {
  useEffect(() => {
    LuigiClient.addInitListener(() => {});
  }, []);
}
