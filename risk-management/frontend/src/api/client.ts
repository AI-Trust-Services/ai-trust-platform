import type {
  DemoSummary, DemoSystem, LLMStatus, Risk, RiskClassification,
  VulnerableGroupAssessment, RelatedIncident, Mitigation, ResidualRiskArgument,
} from "../types";

const API_BASE = import.meta.env.VITE_RISK_MANAGEMENT_API_BASE as string;
export const HEALTH_URL = API_BASE.replace("/v1", "") + "/health";

function formatDetail(detail: unknown): string {
  if (!detail) return "";
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    return detail
      .map((e: { loc?: unknown[]; msg?: string }) => {
        const field = Array.isArray(e.loc) ? String(e.loc[e.loc.length - 1]) : "";
        return field ? `${field}: ${e.msg ?? ""}` : (e.msg ?? "");
      })
      .join("; ");
  }
  return String(detail);
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, options);
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { detail?: unknown };
    throw new Error(formatDetail(err.detail) || `HTTP ${res.status}`);
  }
  return res.status === 204 ? (null as unknown as T) : (res.json() as Promise<T>);
}

function json(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

export interface IdentifyResponse {
  backend_used: string;
  risks: Risk[];
  raw_output: Record<string, unknown>;
}

export interface EvaluateResponse {
  risks: Risk[];
  risk_classification: RiskClassification;
  vulnerable_group_assessments: VulnerableGroupAssessment[];
  related_incidents: RelatedIncident[];
}

export interface MitigateResponse {
  mitigations: Mitigation[];
  residual_risk_argument: ResidualRiskArgument;
}

export interface ExportResponse {
  json_output: string;
  markdown_output: string;
  instructions_for_use: string;
}

export interface DPIAResponse {
  dpia_id: string;
  overall_risk_level: string;
  sa_consultation_required: boolean;
  markdown_output: string;
  dpia: Record<string, unknown>;
}

export interface QuestionnaireQuestion {
  id: string;
  category: string;
  question: string;
  hint: string;
  default_severity: string;
  default_likelihood: string;
  default_mitigation: string;
}

export interface QuestionnaireAnswer {
  question_id: string;
  answer: boolean;
  justification: string;
  confidence: string;
  severity_override: string | null;
  likelihood_override: string | null;
  mitigation_override: string | null;
}

export interface QuestionnaireFillResponse {
  questions: QuestionnaireQuestion[];
  answers: QuestionnaireAnswer[];
}

export const api = {
  getDemos: (): Promise<{ demos: DemoSummary[] }> =>
    request("/demos"),

  getDemo: (id: string): Promise<DemoSystem> =>
    request(`/demos/${id}`),

  getLLMStatus: (): Promise<LLMStatus> =>
    request("/llm/status"),

  identifyRisks: (body: {
    system_description: string;
    source_code?: string;
    metadata: Record<string, unknown>;
    use_llm: boolean;
    use_stub: boolean;
    use_risk_atlas_nexus?: boolean;
    use_questionnaire?: boolean;
    questionnaire_answers?: QuestionnaireAnswer[];
  }): Promise<IdentifyResponse> =>
    request("/assessments/identify", json("POST", body)),

  getQuestionnaire: (): Promise<QuestionnaireFillResponse> =>
    request("/assessments/questionnaire"),

  fillQuestionnaire: (body: {
    system_description: string;
    source_code?: string;
    metadata: Record<string, unknown>;
  }): Promise<QuestionnaireFillResponse> =>
    request("/assessments/questionnaire/ai-fill", json("POST", body)),

  evaluateRisks: (body: {
    system_description: string;
    metadata: Record<string, unknown>;
    risks: Risk[];
    use_llm: boolean;
  }): Promise<EvaluateResponse> =>
    request("/assessments/evaluate", json("POST", body)),

  assignMitigations: (body: {
    metadata: Record<string, unknown>;
    risks: Risk[];
    use_llm: boolean;
  }): Promise<MitigateResponse> =>
    request("/assessments/mitigate", json("POST", body)),

  exportRegister: (body: {
    register: Record<string, unknown>;
  }): Promise<ExportResponse> =>
    request("/assessments/export", json("POST", body)),

  generateDpia: (body: {
    register: Record<string, unknown>;
  }): Promise<DPIAResponse> =>
    request("/dpia", json("POST", body)),
};
