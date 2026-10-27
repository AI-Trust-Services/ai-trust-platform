import type {
  AssessmentSummary,
  MySystemRow,
  OpenTaskRow,
} from "../../api/client";

/** Static mock data rendered behind the HeroEmptyState curtain so a brand-new
 *  user still sees what the two tables will look like once populated. */

const NOW = Date.now();
const DAY = 24 * 60 * 60 * 1000;

export const MOCK_OPEN_TASKS: OpenTaskRow[] = [
  {
    source: "assigned",
    system_id: "SYS-DEMO-01",
    system_name: "Credit Scoring Engine",
    system_version: "1.0.0",
    section: "business",
    workflow_status: "business_pending",
    question_key: "data_and_inputs",
    question_label: "Which data sources train the model?",
    assigned_at: new Date(NOW - 4 * DAY).toISOString(),
    assigned_by_username: "anna.kowalski",
    owner_username: "anna.kowalski",
    assignment_id: "QA-DEMO-01",
  },
  {
    source: "assigned",
    system_id: "SYS-DEMO-02",
    system_name: "CV Screening Assistant",
    system_version: "0.9.1",
    section: "business",
    workflow_status: "business_pending",
    question_key: "automation_and_oversight",
    question_label: "Describe human oversight measures",
    assigned_at: new Date(NOW - 2 * DAY).toISOString(),
    assigned_by_username: "anna.kowalski",
    owner_username: "anna.kowalski",
    assignment_id: "QA-DEMO-02",
  },
  {
    source: "required",
    system_id: "SYS-DEMO-03",
    system_name: "Customer Support Chatbot",
    system_version: "2.3.0",
    section: "technical",
    workflow_status: "technical_pending",
    question_key: "model_nature",
    question_label: "Model nature",
    assigned_at: new Date(NOW - 1 * DAY).toISOString(),
    assigned_by_username: "marcus.weber",
    owner_username: "marcus.weber",
  },
];

export const MOCK_MY_SYSTEMS: MySystemRow[] = [
  {
    id: "SYS-DEMO-01",
    name: "Credit Scoring Engine",
    tier: "high",
    workflow_status: "business_pending",
    is_chatbot: false,
    generates_synthetic_content: false,
    business_owners: "anna.kowalski",
    contributors: ["sam.lee", "jane.doe"],
    assignee_username: null,
    business_assignee_username: "anna.kowalski",
    technical_assignee_username: "sam.lee",
    compliance_officer_username: "comp",
    updated_at: new Date(NOW - 1 * DAY).toISOString(),
    created_at: new Date(NOW - 10 * DAY).toISOString(),
  },
  {
    id: "SYS-DEMO-02",
    name: "CV Screening Assistant",
    tier: "high",
    workflow_status: "business_pending",
    is_chatbot: false,
    generates_synthetic_content: false,
    business_owners: "anna.kowalski",
    contributors: ["sam.lee"],
    assignee_username: null,
    business_assignee_username: "anna.kowalski",
    technical_assignee_username: null,
    compliance_officer_username: "comp",
    updated_at: new Date(NOW - 3 * DAY).toISOString(),
    created_at: new Date(NOW - 15 * DAY).toISOString(),
  },
  {
    id: "SYS-DEMO-03",
    name: "Customer Support Chatbot",
    tier: "limited",
    workflow_status: "technical_pending",
    is_chatbot: true,
    generates_synthetic_content: true,
    business_owners: "marcus.weber",
    contributors: ["jane.doe"],
    assignee_username: null,
    business_assignee_username: "marcus.weber",
    technical_assignee_username: "jane.doe",
    compliance_officer_username: "comp",
    updated_at: new Date(NOW - 5 * DAY).toISOString(),
    created_at: new Date(NOW - 20 * DAY).toISOString(),
  },
];

export const MOCK_ASSESSMENTS: AssessmentSummary[] = [
  {
    id: "ASS-DEMO-01",
    ai_system_id: "SYS-DEMO-01",
    status: "draft",
    framework_id: "FRM-EU-AI-ACT",
    created_at: new Date(NOW - 9 * DAY).toISOString(),
    updated_at: new Date(NOW - 1 * DAY).toISOString(),
  },
  {
    id: "ASS-DEMO-02",
    ai_system_id: "SYS-DEMO-02",
    status: "draft",
    framework_id: "FRM-EU-AI-ACT",
    created_at: new Date(NOW - 14 * DAY).toISOString(),
    updated_at: new Date(NOW - 3 * DAY).toISOString(),
  },
];
