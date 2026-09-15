import type { ReactNode } from "react";
import { usePermissions } from "../hooks/usePermissions";
import { NoAccess } from "./NoAccess";

export function RequirePermission({
  anyOf,
  children,
}: {
  anyOf: string[];
  children: ReactNode;
}) {
  const { can, loading } = usePermissions();
  if (loading) return null;
  return anyOf.some(can) ? children : <NoAccess />;
}
