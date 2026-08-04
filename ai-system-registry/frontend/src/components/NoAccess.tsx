/**
 * Shown when the current user holds none of the permissions required for this
 * page. UX-only — the backend enforces permissions independently. The Luigi
 * shell also hides the nav node entirely; this covers direct URL access.
 */
export function NoAccess() {
  return (
    <div className="content">
      <div className="empty-state">
        <div className="empty-icon">🔒</div>
        <h3>Kein Zugriff</h3>
        <p>Ihnen fehlt die Berechtigung für diese Seite.</p>
      </div>
    </div>
  );
}
