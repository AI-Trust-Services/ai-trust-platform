import { Lock } from "lucide-react";

/**
 * Shown when the current user holds none of the permissions required for this
 * page. UX-only — the backend enforces permissions independently. The Luigi
 * shell also hides the nav node entirely; this covers direct URL access.
 */
export function NoAccess() {
  return (
    <div className="flex flex-col gap-3 px-6 py-5">
      <div className="py-20 text-center text-muted-foreground">
        <Lock className="mx-auto mb-4 size-9 text-muted-foreground" />
        <h3 className="mb-2 text-base font-semibold text-foreground">No Access</h3>
        <p>You don't have permission to view this page.</p>
      </div>
    </div>
  );
}
