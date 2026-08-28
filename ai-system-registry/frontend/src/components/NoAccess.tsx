/**
 * Shown when the current user holds none of the permissions required for this
 * page. UX-only — the backend enforces permissions independently. The Luigi
 * shell also hides the nav node entirely; this covers direct URL access.
 */
export function NoAccess() {
  return (
    <div className="px-6 py-5">
      <div className="px-6 py-20 text-center text-muted-foreground">
        <div className="mb-4 text-4xl">🔒</div>
        <h3 className="mb-2 text-base font-semibold text-foreground">No Access</h3>
        <p>You don't have permission to view this page.</p>
      </div>
    </div>
  );
}
