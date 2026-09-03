import type { AISystem, WorkflowStep, QuestionAssignment } from "../types";
import type { SectionKey } from "../config/questionnaire";

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

export const registryClient = {
  getSystem: (id: string) => request<AISystem>(`/systems/${id}`),

  getSystems: () => request<AISystem[]>("/systems?limit=200"),

  updateSystem: (id: string, data: Record<string, unknown>) =>
    request<AISystem>(`/systems/${id}`, { method: "PUT", ...json(data) }),

  patchQuestionnaireAnswers: (systemId: string, answers: Record<string, string>, section: SectionKey = "business") =>
    request<AISystem>(`/systems/${encodeURIComponent(systemId)}/questionnaire`, {
      method: "PATCH",
      ...json({ answers, section }),
    }),

  assignWorkflow: (systemId: string, body: { business_assignee_username: string; technical_assignee_username?: string; compliance_officer_username?: string; note?: string }) =>
    request<WorkflowStep[]>(`/systems/${systemId}/workflow/assign`, { method: "POST", ...json(body) }),

  submitBusinessSection: (systemId: string, note?: string) =>
    request<WorkflowStep[]>(`/systems/${systemId}/workflow/submit-business`, { method: "POST", ...json({ note: note ?? null }) }),

  submitTechnicalSection: (systemId: string, note?: string) =>
    request<WorkflowStep[]>(`/systems/${systemId}/workflow/submit-technical`, { method: "POST", ...json({ note: note ?? null }) }),

  getWorkflow: (systemId: string) =>
    request<WorkflowStep[]>(`/systems/${systemId}/workflow`),

  getQuestionAssignments: (systemId: string) =>
    request<QuestionAssignment[]>(`/systems/${encodeURIComponent(systemId)}/workflow/question-assignments`),

  questionAssign: (systemId: string, body: { section: string; question_key: string; assignee_username: string; note?: string }) =>
    request<QuestionAssignment[]>(`/systems/${encodeURIComponent(systemId)}/workflow/question-assign`, { method: "POST", ...json(body) }),

  questionUnassign: (systemId: string, body: { section: string; question_key: string }) =>
    request<QuestionAssignment[]>(`/systems/${encodeURIComponent(systemId)}/workflow/question-assign`, { method: "DELETE", ...json(body) }),

  questionAnswer: (systemId: string, body: { section: string; question_key: string }) =>
    request<QuestionAssignment[]>(`/systems/${encodeURIComponent(systemId)}/workflow/question-answer`, { method: "POST", ...json(body) }),

  subAssign: (systemId: string, section: SectionKey, subAssigneeUsername: string, note?: string) =>
    request<WorkflowStep[]>(`/systems/${systemId}/workflow/sub-assign`, { method: "POST", ...json({ section, sub_assignee_username: subAssigneeUsername, note: note ?? null }) }),

  subComplete: (systemId: string, section: SectionKey, note?: string) =>
    request<WorkflowStep[]>(`/systems/${systemId}/workflow/sub-complete`, { method: "POST", ...json({ section, note: note ?? null }) }),

  subReclaim: (systemId: string, section: SectionKey, note?: string) =>
    request<WorkflowStep[]>(`/systems/${systemId}/workflow/sub-reclaim`, { method: "POST", ...json({ section, note: note ?? null }) }),

  questionnaireExtract: (systemId: string, section: SectionKey, file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return request<{ extracted_fields: Record<string, string>; notes: string }>(`/intake/assist/questionnaire/${encodeURIComponent(systemId)}/extract?section=${section}`, { method: "POST", body: fd });
  },

  getUsersByRole: (role: string) =>
    request<Array<{ username: string; firstName: string; lastName: string }>>(`/users/by-role?role=${encodeURIComponent(role)}`, {}, USERS_API_BASE),

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

  getRceSummary: (systemId: string) =>
    request<{
      tier: string | null;
      org_role: string | null;
      registration_mode: string | null;
      classification_rationale: unknown;
      obligations: Array<{ title: string; article_ref: string; description: string }>;
    }>(`/systems/${encodeURIComponent(systemId)}/workflow/rce-summary`),

  approveSystem: (systemId: string, note?: string, tier?: string, orgRole?: string) =>
    request<unknown>(`/systems/${encodeURIComponent(systemId)}/workflow/approve`, {
      method: "POST", ...json({ note: note ?? null, tier: tier ?? null, org_role: orgRole ?? null }),
    }),

  rejectSystem: (systemId: string, note: string, assigneeUsername: string, sendTo: "business" | "technical" = "business") =>
    request<unknown>(`/systems/${encodeURIComponent(systemId)}/workflow/reject`, {
      method: "POST", ...json({ note, assignee_username: assigneeUsername, send_to: sendTo }),
    }),

  requestInfo: (systemId: string, contributorUsername: string, note: string) =>
    request<unknown>(`/systems/${encodeURIComponent(systemId)}/workflow/request-info`, {
      method: "POST", ...json({ contributor_username: contributorUsername, note }),
    }),

  resetWorkflow: (systemId: string) =>
    request<{ status: string }>(`/systems/${encodeURIComponent(systemId)}/workflow/reset`, {
      method: "POST",
    }),
};
