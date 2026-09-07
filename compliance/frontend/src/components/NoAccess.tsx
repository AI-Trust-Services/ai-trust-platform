import { Lock } from "lucide-react";

/**
 * Shown when the current user holds none of the permissions required for this
 * page. UX-only — the backend enforces permissions independently. The Luigi
 * shell also hides the nav node entirely; this covers direct URL access.
 */
export function NoAccess() {
  return (
    <div className="px-5 py-3">
      <div className="flex flex-col items-center gap-3 px-6 py-20 text-center text-muted-foreground">
        <span className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Lock className="size-6" />
        </span>
        <h3 className="text-base font-semibold text-foreground">No Access</h3>
        <p>You don't have permission to view this page.</p>
      </div>
    </div>
  );
}
