const API_BASE = import.meta.env.VITE_REGISTRY_API_BASE;
const USERS_API_BASE = import.meta.env.VITE_USERS_API_BASE;

async function request<T>(path: string, options: RequestInit = {}, base: string = API_BASE): Promise<T> {
  const res = await fetch(`${base}${path}`, options);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `HTTP ${res.status}`);
  }
  return res.status === 204 ? (null as T) : res.json();
}

function json(body: unknown): RequestInit {
  return { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

// The section-based questionnaire/classification/CO-review endpoints were retired
// with the single-page assessment redesign. What remains here are the two
// flow-agnostic workflow utilities the compliance MFE still uses — recording
// assignees/intended-purpose at assessment creation (`assignWorkflow`) and
// resetting a system's workflow state when an in-progress assessment is deleted
// (`resetWorkflow`) — plus user lookups for the create modal.
export const registryClient = {
  assignWorkflow: (
    systemId: string,
    body: {
      business_assignee_username: string;
      technical_assignee_username?: string;
      compliance_officer_username?: string;
      intended_purpose?: string;
      note?: string;
    },
  ) =>
    request<unknown>(`/systems/${systemId}/workflow/assign`, { method: "POST", ...json(body) }),

  resetWorkflow: (systemId: string) =>
    request<{ status: string }>(`/systems/${encodeURIComponent(systemId)}/workflow/reset`, {
      method: "POST",
    }),

  startNewAssessment: (systemId: string) =>
    request<unknown>(`/systems/${encodeURIComponent(systemId)}/assessment/start-new`, {
      method: "POST",
    }),

  getAllUsers: async (): Promise<Array<{ username: string; firstName: string; lastName: string; role: string }>> => {
    const ROLES = [
      "platform_administrator", "ai_engineer", "ai_compliance_officer",
      "business_owner", "auditor", "executive",
    ];
    const lists = await Promise.all(
      ROLES.map((role) =>
        request<Array<{ username: string; firstName: string; lastName: string }>>(
          `/users/by-role?role=${encodeURIComponent(role)}`,
          {},
          USERS_API_BASE,
        )
          .then((users) => users.map((u) => ({ ...u, role })))
          .catch(() => [] as Array<{ username: string; firstName: string; lastName: string; role: string }>),
      ),
    );
    const seen = new Set<string>();
    return lists.flat().filter((u) => {
      if (seen.has(u.username)) return false;
      seen.add(u.username);
      return true;
    });
  },
};
