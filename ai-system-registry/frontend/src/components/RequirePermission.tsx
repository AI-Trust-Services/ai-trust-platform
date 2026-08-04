import { usePermissions } from "../hooks/usePermissions";
import { NoAccess } from "./NoAccess";

/**
 * Renders `children` only if the user holds at least one of `anyOf`; otherwise
 * shows a "no access" screen. Guards whole pages against direct URL access —
 * the Luigi shell already hides the nav node. UX-only; backend enforces.
 *
 * Fail-closed: while permissions load (`loading`), nothing renders (no flash of
 * NoAccess before the real permissions arrive).
 */
export function RequirePermission({
  anyOf,
  children,
}: {
  anyOf: string[];
  children: JSX.Element;
}) {
  const { can, loading } = usePermissions();
  if (loading) return null;
  return anyOf.some(can) ? children : <NoAccess />;
}
