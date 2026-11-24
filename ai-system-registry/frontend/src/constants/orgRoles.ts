// Shared organisation-role display labels. Imported by Systems.tsx and the
// assessment views so a new role is added in exactly one place.
export const ORG_ROLE_LABELS: Record<string, string> = {
  pending: "Pending",
  provider: "Provider (Art. 3(3))",
  deployer: "Deployer (Art. 3(4))",
  both: "Both Provider and Deployer",
  importer: "Importer",
  distributor: "Distributor",
  authorised_representative: "Authorised Representative",
};

// Compact label with the article reference dropped (e.g. "Provider (Art. 3(3))"
// → "Provider") for inline "Role: X" displays and table badges. A null/empty
// role renders as "Pending" — the registry intake default before an assessment
// resolves the real role.
export function orgRoleLabel(role: string | null | undefined): string {
  if (!role) return "Pending";
  return (ORG_ROLE_LABELS[role] ?? role).replace(/\s*\(.*\)\s*$/, "");
}
