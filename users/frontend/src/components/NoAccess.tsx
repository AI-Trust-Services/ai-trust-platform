export function NoAccess() {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "60px 20px", textAlign: "center" }}>
      <div style={{ fontSize: 40, marginBottom: 16 }}>🔒</div>
      <h3 style={{ margin: "0 0 8px" }}>No Access</h3>
      <p style={{ color: "#556b82", margin: 0 }}>You don't have permission to view this page.</p>
    </div>
  );
}
