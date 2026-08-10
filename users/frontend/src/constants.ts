export const ROLE_LABELS: Record<string, string> = {
  platform_administrator: "Platform Administrator",
  ai_engineer: "AI Engineer",
  business_owner: "Business Owner",
  ai_compliance_officer: "AI Compliance Officer",
  auditor: "Auditor",
  executive: "Executive",
};

export const PERMISSION_LABELS: Record<string, string> = {
  "systems:read": "View AI systems",
  "systems:write": "Create & edit AI systems",
  "assessments:read": "View assessments",
  "assessments:write": "Create & edit assessments",
  "assessments:approve": "Approve assessments",
  "evidence:read": "View evidence",
  "evidence:write": "Upload & edit evidence",
  "evidence:approve": "Approve evidence",
  "alerts:read": "View alerts",
  "alerts:handle": "Handle & resolve alerts",
  "alerts:manage_rules": "Manage alert rules",
  "monitoring:read": "View monitoring data",
  "iam:manage": "Manage users & roles",
};
