import type { AISystem, WorkflowStep } from "../types";

export type SectionKey = "business" | "technical";

export interface QuestionDef {
  key: string;
  label: string;
  hint: string;
  type: "text" | "textarea" | "boolean" | "number" | "select";
  storage: "system" | "answers";
  options?: string[];
  /** Genuinely optional free-text question — never counted as a completeness gap. */
  optional?: boolean;
}

// ─── General Information ──────────────────────────────────────────────────────

export const BUSINESS_QUESTIONS: QuestionDef[] = [
  {
    key: "submission_type",
    label: "Type of Submission",
    hint: "Is this the first time you are registering this AI system, or a resubmission?",
    type: "select",
    storage: "answers",
    options: [
      "Initial Submission (first time registering this AI system)",
      "Update / Correction Submission (resubmission after feedback or system changes)",
    ],
  },
  {
    key: "external_id",
    label: "External System ID",
    hint: "If your system is already tracked in an external register or ticketing system, provide the ID here. Leave blank if not applicable.",
    type: "text",
    storage: "answers",
    optional: true,
  },
  {
    key: "use_case_owner",
    label: "Use Case Owner",
    hint: "Name of the person responsible for coordinating the delivery of this AI system end-to-end.",
    type: "text",
    storage: "answers",
  },
  {
    key: "use_case_type",
    label: "Type of Use Case",
    hint: "Select the category that best describes how this AI system is developed and deployed.",
    type: "select",
    storage: "answers",
    options: [
      "Standard development planned for general availability",
      "Customer-specific development",
      "Internal development for own organisational use",
      "Third-party system or product planned for integration",
      "Third-party system or product for internal use",
      "Partner-developed system",
      "Professional services — multi-customer solution",
    ],
  },
  {
    key: "department",
    label: "Developing Business Unit",
    hint: "Which department, team, or line of business is developing or owning this AI system?",
    type: "text",
    storage: "system",
  },
  {
    key: "technologies",
    label: "Technologies Involved",
    hint: "List the main technologies, models, frameworks, or platforms used (e.g. LLMs, ML models, APIs, cloud services).",
    type: "textarea",
    storage: "answers",
  },
  {
    key: "use_case_status",
    label: "Status of AI Use Case",
    hint: "Is this a new AI use case or does it already exist in some form?",
    type: "select",
    storage: "answers",
    options: [
      "New AI use case",
      "Existing AI use case",
      "Other",
    ],
  },
  {
    key: "use_case",
    label: "Detailed Description",
    hint: "Provide a detailed description covering: system architecture overview, purpose and goals, technologies used, input/output data, planned deployment timeline, human oversight touchpoints, and development stage.",
    type: "textarea",
    storage: "system",
  },
  {
    key: "planned_modifications",
    label: "Planned Changes (12–24 months)",
    hint: "Are architectural or functional changes planned in the next 12–24 months? If yes, describe what will change and why. If no, write N/A.",
    type: "textarea",
    storage: "answers",
  },
  {
    key: "entity_role",
    label: "Organisation's Role",
    hint: "How does your organisation relate to this AI system?",
    type: "select",
    storage: "answers",
    options: [
      "Provider — we develop this AI system and make it available internally or externally",
      "Deployer — the system was developed by a third party and we operate it for our own purposes",
      "None of the above (Distributor, Importer, Product Manufacturer, Authorised Representative, or Operator)",
    ],
  },
  {
    key: "additional_entity_roles",
    label: "Additional Roles (if applicable)",
    hint: "If your organisation also acts as Distributor, Importer, Product Manufacturer, Authorised Representative, or Operator, describe that role here.",
    type: "textarea",
    storage: "answers",
    optional: true,
  },
  {
    key: "used_in_eu",
    label: "Used in the European Union",
    hint: "Is this AI system going to be used, placed on the market, or put into service in the European Union?",
    type: "boolean",
    storage: "answers",
  },
  {
    key: "exception_category",
    label: "Exception Category",
    hint: "Does your AI system fall into any category that is fully out of scope of the EU AI Act?",
    type: "select",
    storage: "answers",
    options: [
      "AI systems developed and used exclusively for military purposes (Art. 2(3))",
      "AI systems used by public authorities in third countries for law enforcement (Art. 2(4))",
      "AI research and development activity (Art. 2(6))",
      "People using AI systems for purely personal, non-professional activity (Art. 2(10))",
      "AI components provided under free and open-source licences (Art. 2(12)) — only for non-GPAI models",
      "None of the above",
    ],
  },
  {
    key: "sector_legislation",
    label: "Sector-Specific Legislation",
    hint: "Is this AI system part of a product already regulated under existing sector-specific EU legislation or Union Harmonisation Regulations (e.g. medical devices, machinery, vehicles)?",
    type: "select",
    storage: "answers",
    options: [
      "Yes — covered by sector-specific legislation",
      "Yes — covered by Union Harmonisation Regulation",
      "None of the above",
    ],
  },
];

// ─── Risk Classification ──────────────────────────────────────────────────────

export const TECHNICAL_QUESTIONS: QuestionDef[] = [
  // Art. 5 — Prohibited Use
  {
    key: "subliminal_manipulation",
    label: "Manipulative or Deceptive Techniques",
    hint: "Does the system deploy subliminal, purposefully manipulative, or deceptive techniques that materially influence behaviour in significantly harmful ways, impairing individual autonomy, decision-making, and free choice?",
    type: "boolean",
    storage: "system",
  },
  {
    key: "exploits_vulnerability",
    label: "Exploits Vulnerabilities",
    hint: "Does it exploit vulnerabilities of specific groups (e.g. due to age, disability, or social/economic situation)?",
    type: "boolean",
    storage: "system",
  },
  {
    key: "social_scoring_public",
    label: "Social Scoring by Public Authority",
    hint: "Is it used by public authorities for social scoring — evaluating or classifying natural persons based on their social behaviour?",
    type: "boolean",
    storage: "system",
  },
  {
    key: "real_time_biometric_public",
    label: "Real-time Biometric ID in Public Spaces",
    hint: "Does it use real-time remote biometric identification in publicly accessible spaces?",
    type: "boolean",
    storage: "system",
  },
  {
    key: "emotion_recognition_workplace",
    label: "Emotion Recognition (Workplace / Education)",
    hint: "Does it perform emotion recognition in workplace or educational settings?",
    type: "boolean",
    storage: "system",
  },
  {
    key: "untargeted_facial_scraping",
    label: "Untargeted Facial Image Scraping",
    hint: "Does it create or expand facial recognition databases through untargeted scraping of facial images from the internet or CCTV?",
    type: "boolean",
    storage: "system",
  },
  {
    key: "predictive_policing",
    label: "Predictive Policing",
    hint: "Does it make individual criminal risk assessments used by law enforcement (predictive policing)?",
    type: "boolean",
    storage: "system",
  },
  {
    key: "biometric_categorisation_sensitive",
    label: "Biometric Categorisation by Sensitive Attributes",
    hint: "Does it categorise people based on sensitive biometric attributes such as race, political views, religion, or sexual orientation?",
    type: "boolean",
    storage: "system",
  },

  // Annex III — High-Risk Domains (from Q17 of the EU AI Act questionnaire)
  {
    key: "is_biometric_identification",
    label: "Identity & Biometric Analysis",
    hint: "Facial recognition, emotion detection, or categorising individuals based on biometric traits like age or gender.",
    type: "boolean",
    storage: "system",
  },
  {
    key: "is_critical_infrastructure",
    label: "Infrastructure Management",
    hint: "Critical infrastructure, AI managing traffic systems, energy grids, or water supply.",
    type: "boolean",
    storage: "system",
  },
  {
    key: "is_education_related",
    label: "Education & Training",
    hint: "AI grading exams, monitoring students, or deciding access to training programmes.",
    type: "boolean",
    storage: "system",
  },
  {
    key: "is_employment_related",
    label: "Human Resources (HR)",
    hint: "Employment, workers management, and access to self-employment — AI screening CVs, evaluating performance, or assigning tasks.",
    type: "boolean",
    storage: "system",
  },
  {
    key: "is_credit_scoring",
    label: "Financial & Healthcare Services",
    hint: "Access to and enjoyment of essential private or public services — AI used in credit scoring, insurance pricing, or healthcare triage.",
    type: "boolean",
    storage: "system",
  },
  {
    key: "is_public_service",
    label: "Essential Public Services",
    hint: "AI used for access to essential public services or benefits.",
    type: "boolean",
    storage: "system",
  },
  {
    key: "is_law_enforcement",
    label: "Public Safety & Policing",
    hint: "Law enforcement — predictive policing, criminal profiling, or evidence analysis, in so far as permitted by law.",
    type: "boolean",
    storage: "system",
  },
  {
    key: "is_migration",
    label: "Immigration & Border Control",
    hint: "Migration, asylum, and border control management — AI used in visa processing, asylum decisions, or document verification.",
    type: "boolean",
    storage: "system",
  },
  {
    key: "is_judicial_admin",
    label: "Legal & Democratic Governance",
    hint: "Administration of justice and democratic processes — AI supporting legal decisions, moderating political content, or influencing elections.",
    type: "boolean",
    storage: "system",
  },

  // GPAI
  {
    key: "is_gpai",
    label: "General-Purpose AI (GPAI)",
    hint: "Is this a General-Purpose AI model — a model trained on large amounts of data that can be used across many different tasks (e.g. an LLM)?",
    type: "boolean",
    storage: "system",
  },
  {
    key: "training_compute_flops",
    label: "Training Compute (FLOPs)",
    hint: "Estimated training compute in floating-point operations. Enter 0 if unknown. ≥ 10²⁵ FLOPs indicates systemic risk under the EU AI Act.",
    type: "number",
    storage: "system",
  },

  // Art. 50 — Transparency / Limited Risk
  {
    key: "is_chatbot",
    label: "Conversational AI / Chatbot",
    hint: "Is it a chatbot or conversational AI system that interacts directly with humans?",
    type: "boolean",
    storage: "system",
  },
  {
    key: "generates_synthetic_content",
    label: "Generates Synthetic Content",
    hint: "Does it generate synthetic content such as text, images, audio, video, or deepfakes?",
    type: "boolean",
    storage: "system",
  },
];

/** Extract current business field values from a system (for pre-seeding the chatbot). */
export function getBusinessFieldValues(system: AISystem): Record<string, string> {
  const result: Record<string, string> = {};
  for (const q of BUSINESS_QUESTIONS) {
    if (q.storage === "system") {
      const v = (system as unknown as Record<string, unknown>)[q.key];
      if (v != null && v !== "") result[q.key] = String(v);
    } else {
      const v = (system.questionnaire_answers as Record<string, unknown> | null)?.[q.key];
      if (v != null && v !== "") result[q.key] = String(v);
    }
  }
  return result;
}

// ─── AI-mode Risk Classification (free-text) ───────────────────────────────────
// In AI mode the classifier flags are hidden. The technical assignee answers these
// open questions instead; their free-text answers are stored under
// questionnaire_answers["technical"] and the LLM infers the hidden flags from them
// at submit-technical. Deterministic classify() then produces the tier.

export const AI_TECHNICAL_QUESTIONS: QuestionDef[] = [
  {
    key: "data_and_inputs",
    label: "Data & Inputs",
    hint: "What data does the system process? Does it include biometric, health, or other sensitive personal data?",
    type: "textarea",
    storage: "answers",
  },
  {
    key: "decision_domain",
    label: "Domain of Use",
    hint: "In what domain does the system operate — e.g. employment, credit/insurance, healthcare, law enforcement, education, migration, critical infrastructure, justice?",
    type: "textarea",
    storage: "answers",
  },
  {
    key: "automation_and_oversight",
    label: "Autonomy & Human Oversight",
    hint: "How autonomous is the system, and what human oversight exists over its outputs before they take effect?",
    type: "textarea",
    storage: "answers",
  },
  {
    key: "affected_people",
    label: "Impact on People",
    hint: "Who is affected by the system's outputs, and how significant are the consequences for them?",
    type: "textarea",
    storage: "answers",
  },
  {
    key: "model_nature",
    label: "Model Nature",
    hint: "Is this a general-purpose AI model (e.g. an LLM)? If so, roughly what training compute (FLOPs) was used?",
    type: "textarea",
    storage: "answers",
  },
  {
    key: "user_interaction",
    label: "User Interaction & Content",
    hint: "Does the system interact directly with people (chatbot) or generate synthetic media (text, images, audio, video, deepfakes)?",
    type: "textarea",
    storage: "answers",
  },
  {
    key: "prohibited_practices",
    label: "Prohibited Practices Check",
    hint: "Does the system involve any of: subliminal manipulation, social scoring, real-time public biometric identification, emotion recognition at work/school, untargeted facial scraping, or predictive policing?",
    type: "textarea",
    storage: "answers",
  },
];

/** Technical question set for a given registration mode. */
export function technicalQuestionsForMode(mode: string | undefined): QuestionDef[] {
  return mode === "ai" ? AI_TECHNICAL_QUESTIONS : TECHNICAL_QUESTIONS;
}

/** Extract current AI-mode technical answers (nested under "technical"). */
export function getAITechnicalFieldValues(system: AISystem): Record<string, string> {
  const technical = (system.questionnaire_answers as Record<string, unknown> | null)?.technical as
    | Record<string, unknown>
    | undefined;
  const result: Record<string, string> = {};
  if (!technical) return result;
  for (const q of AI_TECHNICAL_QUESTIONS) {
    const v = technical[q.key];
    if (v != null && v !== "") result[q.key] = String(v);
  }
  return result;
}

/** Extract current technical flag values from a system (for pre-seeding the chatbot). */
export function getTechnicalFieldValues(system: AISystem): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const q of TECHNICAL_QUESTIONS) {
    const v = (system as unknown as Record<string, unknown>)[q.key];
    if (v != null) result[q.key] = v;
  }
  return result;
}

// ─── Completeness helpers ──────────────────────────────────────────────────────
// The compliance officer cannot approve until every required question is answered.
// Boolean/number inputs are always considered answered (an unchecked box / 0 is valid),
// and questions flagged `optional` never count as a gap.

export function requiredQuestions(questions: QuestionDef[]): QuestionDef[] {
  return questions.filter((q) => !q.optional && q.type !== "boolean" && q.type !== "number");
}

/** Required questions with no non-empty value in `fields`. */
export function missingRequired(
  questions: QuestionDef[],
  fields: Record<string, unknown>,
): QuestionDef[] {
  return requiredQuestions(questions).filter((q) => {
    const v = fields[q.key];
    return v == null || (typeof v === "string" && v.trim() === "");
  });
}

// ─── Sub-assignment (delegation) state ─────────────────────────────────────────
// Delegation is encoded as workflow steps (no DB column), so the active contributor
// is derived from the ordered step history — mirroring the backend's
// _active_sub_assignment(). Steps arrive ordered oldest-first (by created_at).

export function activeSubAssignee(steps: WorkflowStep[], section: SectionKey): string | null {
  const suffix = `_${section}`;
  const kinds = ["sub_assigned", "sub_completed", "sub_reclaimed"];
  const rel = steps.filter(
    (s) => s.step.endsWith(suffix) && kinds.includes(s.step.slice(0, -suffix.length)),
  );
  if (!rel.length) return null;
  const latest = rel[rel.length - 1];
  return latest.step === `sub_assigned${suffix}` ? latest.assignee_username ?? null : null;
}
