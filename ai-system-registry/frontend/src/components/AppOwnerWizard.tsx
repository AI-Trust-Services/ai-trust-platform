import { useState, useEffect, useRef } from "react";
import { Button, Chip, Spinner, Avatar } from "@heroui/react";
import { api, type UserSummary } from "../api/client";
import { useToast } from "../App";

// Application Owner registration data
interface AppOwnerFormData {
  systemName: string;
  purpose: string;
  department: string;
  useCase: string;
  peopleAffected: string;
  decisionContext: "supports" | "influences" | "automates" | "";
  humanInvolvement: "ai_decides" | "ai_recommends" | "human_decides" | "";
  dueDate: string; // ISO date string
  priority: "low" | "medium" | "high" | "critical";
}

// Chat message type
interface ChatMessage {
  role: "assistant" | "user";
  content: string;
}

const EMPTY_FORM: AppOwnerFormData = {
  systemName: "",
  purpose: "",
  department: "",
  useCase: "",
  peopleAffected: "",
  decisionContext: "",
  humanInvolvement: "",
  dueDate: "",
  priority: "medium",
};

// Mandatory fields for submission
const MANDATORY_FIELDS: (keyof AppOwnerFormData)[] = [
  "systemName",
  "purpose",
  "department",
  "useCase",
  "peopleAffected",
  "decisionContext",
  "humanInvolvement",
];

const USE_CASES = [
  { value: "recruiting", label: "Recruiting / HR" },
  { value: "customer_service", label: "Customer Service" },
  { value: "finance", label: "Finance / Banking" },
  { value: "healthcare", label: "Healthcare" },
  { value: "legal", label: "Legal" },
  { value: "marketing", label: "Marketing" },
  { value: "operations", label: "Operations" },
  { value: "research", label: "Research & Development" },
  { value: "other", label: "Other" },
];

const PEOPLE_AFFECTED = [
  { value: "customers", label: "Customers" },
  { value: "employees", label: "Employees" },
  { value: "applicants", label: "Job Applicants" },
  { value: "partners", label: "Business Partners" },
  { value: "public", label: "General Public" },
  { value: "other", label: "Other" },
];

const DECISION_CONTEXT = [
  { value: "supports", label: "Supports decisions (provides information)" },
  { value: "influences", label: "Influences decisions (shapes outcomes)" },
  { value: "automates", label: "Automates decisions (acts autonomously)" },
];

const HUMAN_INVOLVEMENT = [
  { value: "human_decides", label: "Human decides with AI support" },
  { value: "ai_recommends", label: "AI recommends, human approves" },
  { value: "ai_decides", label: "AI decides autonomously" },
];

const PRIORITIES = [
  { value: "low", label: "Low", color: "#6b7280" },
  { value: "medium", label: "Medium", color: "#3b82f6" },
  { value: "high", label: "High", color: "#f59e0b" },
  { value: "critical", label: "Critical", color: "#ef4444" },
];

interface Props {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  userDepartment?: string;
  userBusinessUnit?: string;
}

type AIStep = "chat" | "risk" | "review" | "handoff";

export default function AppOwnerWizard({ open, onClose, onSuccess, userDepartment = "", userBusinessUnit = "" }: Props) {
  const [mode, setMode] = useState<"choose" | "ai" | "upload" | "manual">("choose");
  const [form, setForm] = useState<AppOwnerFormData>(EMPTY_FORM);
  const [loading, setLoading] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [registeredId, setRegisteredId] = useState<string | null>(null);
  const showToast = useToast();
  const submitting = useRef(false);

  // AI mode state
  const [aiStep, setAiStep] = useState<AIStep>("chat");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [aiThinking, setAiThinking] = useState(false);
  const [isUploadingInChat, setIsUploadingInChat] = useState(false);
  const [uploadedDocsInChat, setUploadedDocsInChat] = useState<{ filename: string; hasInfo: boolean; file?: File }[]>([]);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const chatInputRef = useRef<HTMLInputElement>(null);
  const chatFileInputRef = useRef<HTMLInputElement>(null);

  // Upload mode state
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [uploadAnalysis, setUploadAnalysis] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Manual mode state
  const [manualStep, setManualStep] = useState(0);

  // Reviewer selection state
  const [selectedReviewer, setSelectedReviewer] = useState<UserSummary | null>(null);
  const [recommendedReviewers, setRecommendedReviewers] = useState<UserSummary[]>([]);
  const [otherReviewers, setOtherReviewers] = useState<UserSummary[]>([]);
  const [loadingReviewers, setLoadingReviewers] = useState(false);
  const [userSelectModalOpen, setUserSelectModalOpen] = useState(false);
  const [allUsers, setAllUsers] = useState<UserSummary[]>([]);
  const [loadingAllUsers, setLoadingAllUsers] = useState(false);
  const [noAIEngineersExist, setNoAIEngineersExist] = useState(false);

  // Calculate completion
  const filledCount = MANDATORY_FIELDS.filter((f) => form[f] !== "").length;
  const isComplete = filledCount === MANDATORY_FIELDS.length;
  const completionPct = Math.round((filledCount / MANDATORY_FIELDS.length) * 100);

  useEffect(() => {
    if (open) {
      setMode("choose");
      setAiStep("chat");
      setManualStep(0);
      setForm(EMPTY_FORM);
      setRegisteredId(null);
      setChatMessages([]);
      setChatInput("");
      setIsUploadingInChat(false);
      setUploadedDocsInChat([]);
      setUploadedFile(null);
      setUploadAnalysis(null);
      setSelectedReviewer(null);
      setRecommendedReviewers([]);
      setOtherReviewers([]);
      setNoAIEngineersExist(false);
      submitting.current = false;
    }
  }, [open]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages]);

  // Re-focus chat input after AI finishes thinking
  useEffect(() => {
    if (!aiThinking && aiStep === "chat" && mode === "ai") {
      chatInputRef.current?.focus();
    }
  }, [aiThinking, aiStep, mode]);

  if (!open) return null;

  // Parse extracted data from Claude response
  const parseExtractedData = (response: string): { text: string; extracted: Partial<AppOwnerFormData> } => {
    let extracted: Partial<AppOwnerFormData> = {};
    let text = response;

    const dataMatch = response.match(/<<<EXTRACTED_DATA>>>([\s\S]*?)<<<END_DATA>>>/);
    if (dataMatch) {
      try {
        const parsed = JSON.parse(dataMatch[1].trim());
        if (parsed.systemName) extracted.systemName = String(parsed.systemName);
        if (parsed.purpose) extracted.purpose = String(parsed.purpose);
        if (parsed.department) extracted.department = String(parsed.department);
        if (parsed.useCase && USE_CASES.some((u) => u.value === parsed.useCase)) {
          extracted.useCase = parsed.useCase;
        }
        if (parsed.peopleAffected && PEOPLE_AFFECTED.some((p) => p.value === parsed.peopleAffected)) {
          extracted.peopleAffected = parsed.peopleAffected;
        }
        if (parsed.decisionContext && ["supports", "influences", "automates"].includes(parsed.decisionContext)) {
          extracted.decisionContext = parsed.decisionContext;
        }
        if (parsed.humanInvolvement && ["ai_decides", "ai_recommends", "human_decides"].includes(parsed.humanInvolvement)) {
          extracted.humanInvolvement = parsed.humanInvolvement;
        }
      } catch (e) {
        console.warn("Failed to parse extracted data:", e);
      }
      text = response.replace(/<<<EXTRACTED_DATA>>>[\s\S]*?<<<END_DATA>>>/, "").trim();
    }
    return { text, extracted };
  };

  // Start AI-assisted mode
  const startAiMode = async () => {
    setMode("ai");
    setAiStep("chat");
    setChatMessages([]);
    setUploadedDocsInChat([]);
    setAiThinking(true);

    try {
      const response = await api.chat({
        messages: [{ role: "user", content: "I want to register a new AI system." }],
        form_state: form,
      });
      const { text } = parseExtractedData(response.content);
      // Add mention of document upload capability
      const enhancedText = text + "\n\n💡 **Tip:** You can also upload any related documents (specifications, model cards, etc.) using the 📎 button, and I'll extract the relevant information automatically.";
      setChatMessages([{ role: "assistant", content: enhancedText }]);
    } catch {
      setChatMessages([{
        role: "assistant",
        content: "What is the name of your AI system?\n\n💡 **Tip:** You can also upload any related documents using the 📎 button, and I'll extract the relevant information automatically.",
      }]);
    } finally {
      setAiThinking(false);
    }
  };

  // Handle chat submission
  const handleChatSubmit = async () => {
    if (!chatInput.trim() || aiThinking) return;

    const userMessage = chatInput.trim();
    setChatInput("");
    setChatMessages((msgs) => [...msgs, { role: "user", content: userMessage }]);
    setAiThinking(true);

    try {
      const conversationHistory = chatMessages.map((m) => ({ role: m.role, content: m.content }));
      conversationHistory.push({ role: "user", content: userMessage });

      const response = await api.chat({
        messages: conversationHistory as { role: "user" | "assistant"; content: string }[],
        form_state: {
          systemName: form.systemName,
          purpose: form.purpose,
          department: form.department,
          useCase: form.useCase,
          peopleAffected: form.peopleAffected,
          decisionContext: form.decisionContext,
          humanInvolvement: form.humanInvolvement,
        },
      });

      const { text, extracted } = parseExtractedData(response.content);
      if (Object.keys(extracted).length > 0) {
        setForm((f) => ({ ...f, ...extracted }));
      }
      setChatMessages((msgs) => [...msgs, { role: "assistant", content: text }]);
    } catch (error) {
      setChatMessages((msgs) => [
        ...msgs,
        { role: "assistant", content: `Error: ${(error as Error).message}. Please try again.` },
      ]);
    } finally {
      setAiThinking(false);
    }
  };

  // Handle document upload during AI chat
  const handleChatDocumentUpload = async (file: File) => {
    setIsUploadingInChat(true);
    setChatMessages((msgs) => [
      ...msgs,
      { role: "user", content: `📄 Uploading: ${file.name}` },
    ]);

    try {
      const result = await api.analyzeDocument(file, { contextType: "registration" });

      // Track uploaded document (store file for later attachment)
      setUploadedDocsInChat((docs) => [
        ...docs,
        { filename: file.name, hasInfo: result.has_extractable_info, file: result.has_extractable_info ? file : undefined },
      ]);

      // Apply extracted data to form
      if (result.extracted) {
        const extracted: Partial<AppOwnerFormData> = {};
        if (result.extracted.systemName) extracted.systemName = String(result.extracted.systemName);
        if (result.extracted.purpose) extracted.purpose = String(result.extracted.purpose);
        if (result.extracted.department) extracted.department = String(result.extracted.department);
        if (result.extracted.useCase && USE_CASES.some((u) => u.value === result.extracted!.useCase)) {
          extracted.useCase = String(result.extracted.useCase);
        }
        if (result.extracted.peopleAffected && PEOPLE_AFFECTED.some((p) => p.value === result.extracted!.peopleAffected)) {
          extracted.peopleAffected = String(result.extracted.peopleAffected);
        }
        if (result.extracted.decisionContext && ["supports", "influences", "automates"].includes(String(result.extracted.decisionContext))) {
          extracted.decisionContext = result.extracted.decisionContext as AppOwnerFormData["decisionContext"];
        }
        if (result.extracted.humanInvolvement && ["ai_decides", "ai_recommends", "human_decides"].includes(String(result.extracted.humanInvolvement))) {
          extracted.humanInvolvement = result.extracted.humanInvolvement as AppOwnerFormData["humanInvolvement"];
        }
        setForm((f) => ({ ...f, ...extracted }));
      }

      // Add AI response about the document analysis
      const fieldsExtracted = result.extracted ? Object.keys(result.extracted).length : 0;
      let responseContent = result.content;
      if (fieldsExtracted > 0) {
        responseContent += `\n\nI've extracted ${fieldsExtracted} field(s) from your document. You can see the updated information in the panel on the right.`;
      }
      if (!result.has_extractable_info) {
        responseContent += "\n\nI couldn't find registration-relevant information in this document. Feel free to upload another document or continue answering questions.";
      }

      setChatMessages((msgs) => [...msgs, { role: "assistant", content: responseContent }]);
    } catch (error) {
      setChatMessages((msgs) => [
        ...msgs,
        { role: "assistant", content: `Sorry, I couldn't analyze that document: ${(error as Error).message}. Please try a different file or continue with the questions.` },
      ]);
    } finally {
      setIsUploadingInChat(false);
    }
  };

  // Load reviewers for handover selection
  const loadReviewers = async () => {
    setLoadingReviewers(true);
    try {
      // First, try to get AI Engineers from the same department
      const recommended = userDepartment
        ? await api.getUsersByRole("ai_engineer", userDepartment)
        : [];
      setRecommendedReviewers(recommended);

      // Then get all AI Engineers (for the "other" section)
      const allAiEngineers = await api.getUsersByRole("ai_engineer");
      // Filter out the recommended ones to avoid duplicates
      const recommendedIds = new Set(recommended.map(r => r.id));
      const others = allAiEngineers.filter(u => !recommendedIds.has(u.id));
      setOtherReviewers(others);

      // Check if no AI Engineers exist at all
      if (allAiEngineers.length === 0) {
        setNoAIEngineersExist(true);
      } else {
        setNoAIEngineersExist(false);
      }

      // Auto-select if there's exactly one recommended reviewer
      if (recommended.length === 1) {
        setSelectedReviewer(recommended[0]);
      } else if (recommended.length === 0 && allAiEngineers.length === 1) {
        // If no recommended but only one AI Engineer total, auto-select them
        setSelectedReviewer(allAiEngineers[0]);
      }
    } catch (error) {
      console.error("Failed to load reviewers:", error);
      setRecommendedReviewers([]);
      setOtherReviewers([]);
    } finally {
      setLoadingReviewers(false);
    }
  };

  // Load all users for manual selection modal
  const loadAllUsers = async () => {
    setLoadingAllUsers(true);
    try {
      const users = await api.getHandoverCandidates();
      // If no AI Engineers exist, show all users; otherwise filter to AI Engineers only
      if (noAIEngineersExist) {
        setAllUsers(users);
      } else {
        setAllUsers(users.filter(u => u.roles.includes("ai_engineer")));
      }
    } catch (error) {
      console.error("Failed to load users:", error);
      setAllUsers([]);
    } finally {
      setLoadingAllUsers(false);
    }
  };

  // Handle moving to review step
  const goToReviewStep = () => {
    setAiStep("review");
    loadReviewers();
  };

  // Convert form to API format
  const convertToApiFormat = () => {
    let autonomyLevel: "decision_support" | "human_in_the_loop" | "human_on_the_loop" | "fully_automated" = "decision_support";
    if (form.humanInvolvement === "ai_decides") autonomyLevel = "fully_automated";
    else if (form.humanInvolvement === "ai_recommends") autonomyLevel = "human_in_the_loop";
    else if (form.humanInvolvement === "human_decides") autonomyLevel = "decision_support";

    return {
      name: form.systemName,
      version: "1.0.0",
      provider: "",
      org_name: form.department,
      org_role: "deployer" as const,
      provider_country: "DE",
      system_type: "application" as const,
      autonomy_level: autonomyLevel,
      lifecycle: "development" as const,
      application_url: "",
      description: form.purpose,
      intended_purpose: `Use case: ${form.useCase}. Affects: ${form.peopleAffected}. Decision context: ${form.decisionContext}`,
      is_gpai: false,
      training_compute_flops: 0,
      is_chatbot: false,
      generates_synthetic_content: false,
      subliminal_manipulation: false,
      exploits_vulnerability: false,
      social_scoring_public: false,
      real_time_biometric_public: false,
      emotion_recognition_workplace: false,
      untargeted_facial_scraping: false,
      predictive_policing: false,
      biometric_categorisation_sensitive: false,
      is_biometric_identification: false,
      is_critical_infrastructure: false,
      is_education_related: false,
      is_employment_related: form.useCase === "recruiting",
      is_credit_scoring: form.useCase === "finance",
      is_public_service: false,
      is_law_enforcement: false,
      is_migration: false,
      is_judicial_admin: false,
      due_date: form.dueDate ? new Date(form.dueDate).toISOString() : null,
      priority: form.priority,
    };
  };

  // Submit registration
  const handleSubmit = async () => {
    if (submitting.current) return;
    submitting.current = true;
    setLoading(true);

    try {
      const apiData = convertToApiFormat();
      const result = await api.intake(apiData);
      setRegisteredId(result.id);

      // Attach any documents that were analyzed during chat and had extractable info
      const docsToAttach = uploadedDocsInChat.filter(d => d.hasInfo && d.file);
      for (const doc of docsToAttach) {
        try {
          await api.uploadDocument(result.id, doc.file!, "supporting_doc", "Uploaded during AI-assisted registration");
        } catch (attachErr) {
          console.error("Failed to attach document:", doc.filename, attachErr);
        }
      }

      // If a reviewer is selected, submit for review with assignment
      if (selectedReviewer) {
        await api.submitForReview(result.id, { assign_to: selectedReviewer.username });
      }

      setAiStep("handoff");
      const docsAttached = docsToAttach.length;
      showToast(`AI system registered${docsAttached > 0 ? ` with ${docsAttached} document(s) attached` : ""} and submitted for review`);
      // onSuccess will be called when user clicks Done
    } catch (e) {
      showToast(`Registration failed: ${(e as Error).message}`, true);
    } finally {
      submitting.current = false;
      setLoading(false);
    }
  };

  // Save as draft without submitting for review
  const handleSaveAsDraft = async () => {
    if (submitting.current) return;
    submitting.current = true;
    setSavingDraft(true);

    try {
      const apiData = convertToApiFormat();
      const result = await api.intake(apiData);
      setRegisteredId(result.id);

      // Attach any documents that were analyzed during chat and had extractable info
      const docsToAttach = uploadedDocsInChat.filter(d => d.hasInfo && d.file);
      for (const doc of docsToAttach) {
        try {
          await api.uploadDocument(result.id, doc.file!, "supporting_doc", "Uploaded during AI-assisted registration");
        } catch (attachErr) {
          console.error("Failed to attach document:", doc.filename, attachErr);
        }
      }

      // Do NOT submit for review - just save as draft
      const docsAttached = docsToAttach.length;
      showToast(`AI system saved as draft${docsAttached > 0 ? ` with ${docsAttached} document(s) attached` : ""}. You can submit for review later.`);
      onSuccess();
      onClose();
    } catch (e) {
      showToast(`Save failed: ${(e as Error).message}`, true);
    } finally {
      submitting.current = false;
      setSavingDraft(false);
    }
  };

  // Get label for field value
  const getLabel = (field: keyof AppOwnerFormData, value: string): string => {
    if (field === "useCase") return USE_CASES.find((u) => u.value === value)?.label || value;
    if (field === "peopleAffected") return PEOPLE_AFFECTED.find((p) => p.value === value)?.label || value;
    if (field === "decisionContext") return DECISION_CONTEXT.find((d) => d.value === value)?.label || value;
    if (field === "humanInvolvement") return HUMAN_INVOLVEMENT.find((h) => h.value === value)?.label || value;
    if (field === "priority") return PRIORITIES.find((p) => p.value === value)?.label || value;
    if (field === "dueDate" && value) {
      // Format date for display (e.g., "Aug 25, 2026")
      const date = new Date(value);
      return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    }
    return value;
  };

  // Render progress indicator
  const ProgressIndicator = () => (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6, fontSize: 12 }}>
        <span style={{ color: "var(--text-secondary)" }}>Completion</span>
        <span style={{ fontWeight: 600, color: isComplete ? "#16a34a" : "var(--brand)" }}>{completionPct}%</span>
      </div>
      <div style={{ height: 6, background: "var(--border)", borderRadius: 3, overflow: "hidden" }}>
        <div style={{
          height: "100%",
          width: `${completionPct}%`,
          background: isComplete ? "#16a34a" : "var(--brand)",
          borderRadius: 3,
          transition: "width 0.3s, background 0.3s",
        }} />
      </div>
      <div style={{ marginTop: 8, fontSize: 12, color: "var(--text-secondary)" }}>
        {filledCount} of {MANDATORY_FIELDS.length} required fields
      </div>
    </div>
  );

  // Compute preliminary risk classification based on use case and autonomy
  const getPreliminaryRisk = (): { tier: string; reason: string } | null => {
    if (!form.useCase && !form.humanInvolvement) return null;

    // High-risk indicators based on EU AI Act Annex III
    if (form.useCase === "recruiting") {
      return { tier: "high", reason: "Employment-related AI (Annex III, area 4)" };
    }
    if (form.useCase === "finance") {
      return { tier: "high", reason: "Credit scoring / financial services (Annex III, area 5)" };
    }
    if (form.useCase === "healthcare") {
      return { tier: "high", reason: "Healthcare application (potential Annex III)" };
    }
    if (form.useCase === "legal") {
      return { tier: "high", reason: "Legal/judicial application (potential Annex III)" };
    }

    // Autonomy level affects risk
    if (form.humanInvolvement === "ai_decides" && form.decisionContext === "automates") {
      return { tier: "limited", reason: "Fully autonomous decision-making" };
    }

    // Default for other cases
    if (form.useCase) {
      return { tier: "minimal", reason: "Standard application use case" };
    }

    return null;
  };

  const preliminaryRisk = getPreliminaryRisk();

  // Editable field component for sidebar
  const EditableField = ({ field, label }: { field: keyof AppOwnerFormData; label: string }) => {
    const filled = form[field] !== "";
    const [editing, setEditing] = useState(false);
    const [editValue, setEditValue] = useState(form[field]);

    // Get options for select fields
    const getOptions = () => {
      if (field === "useCase") return USE_CASES;
      if (field === "peopleAffected") return PEOPLE_AFFECTED;
      if (field === "decisionContext") return DECISION_CONTEXT;
      if (field === "humanInvolvement") return HUMAN_INVOLVEMENT;
      if (field === "priority") return PRIORITIES;
      return null;
    };

    const options = getOptions();
    const isSelectField = options !== null;
    const isDateField = field === "dueDate";

    const handleSave = () => {
      setForm((f) => ({ ...f, [field]: editValue }));
      setEditing(false);
    };

    const handleCancel = () => {
      setEditValue(form[field]);
      setEditing(false);
    };

    if (editing) {
      return (
        <div style={{
          padding: "10px 0",
          borderBottom: "1px solid var(--border-light)",
        }}>
          <div style={{ fontSize: 11, color: "var(--text-secondary)", marginBottom: 6, fontWeight: 500 }}>{label}</div>
          {isDateField ? (
            <input
              type="date"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onBlur={handleSave}
              style={{
                width: "100%",
                padding: "8px 10px",
                border: "1px solid var(--primary)",
                borderRadius: 6,
                fontSize: 13,
                outline: "none",
              }}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSave();
                if (e.key === "Escape") handleCancel();
              }}
            />
          ) : isSelectField ? (
            <select
              value={editValue}
              onChange={(e) => {
                setEditValue(e.target.value as typeof editValue);
                // Auto-save on select change
                setForm((f) => ({ ...f, [field]: e.target.value }));
                setEditing(false);
              }}
              onBlur={handleSave}
              style={{
                width: "100%",
                padding: "8px 10px",
                border: "1px solid var(--primary)",
                borderRadius: 6,
                fontSize: 13,
                background: "#fff",
                outline: "none",
              }}
              autoFocus
            >
              <option value="">Select...</option>
              {options.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          ) : (
            <input
              type="text"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onBlur={handleSave}
              style={{
                width: "100%",
                padding: "8px 10px",
                border: "1px solid var(--primary)",
                borderRadius: 6,
                fontSize: 13,
                outline: "none",
              }}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSave();
                if (e.key === "Escape") handleCancel();
              }}
            />
          )}
        </div>
      );
    }

    return (
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 8,
          padding: "10px 0",
          borderBottom: "1px solid var(--border-light)",
          cursor: "pointer",
        }}
        onClick={() => {
          setEditValue(form[field]);
          setEditing(true);
        }}
        title="Click to edit"
      >
        <span style={{
          width: 18,
          height: 18,
          borderRadius: "50%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: filled ? "#f0fdf4" : "var(--bg)",
          color: filled ? "#16a34a" : "var(--text-muted)",
          fontSize: 12,
          flexShrink: 0,
          marginTop: 2,
        }}>
          {filled ? "✓" : "?"}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 11, color: "var(--text-secondary)", marginBottom: 2 }}>{label}</div>
          <div style={{
            fontSize: 13,
            color: filled ? "var(--text)" : "var(--text-muted)",
            fontStyle: filled ? "normal" : "italic",
            overflow: "hidden",
            textOverflow: "ellipsis",
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
          }}>
            {filled ? getLabel(field, form[field]) : "Not provided"}
          </div>
        </div>
        <span style={{ color: "var(--text-muted)", fontSize: 12, flexShrink: 0, marginTop: 2 }}>✎</span>
      </div>
    );
  };

  // Field status component for upload mode
  const FieldStatus = ({ field, label }: { field: keyof AppOwnerFormData; label: string }) => {
    const filled = form[field] !== "";
    return (
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "8px 0",
        borderBottom: "1px solid var(--border-light)",
      }}>
        <span style={{
          width: 18,
          height: 18,
          borderRadius: "50%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: filled ? "#f0fdf4" : "var(--bg)",
          color: filled ? "#16a34a" : "var(--text-muted)",
          fontSize: 12,
          flexShrink: 0,
        }}>
          {filled ? "✓" : "?"}
        </span>
        <span style={{ fontSize: 13, color: "var(--text-secondary)", minWidth: 120 }}>{label}</span>
        <span style={{
          flex: 1,
          fontSize: 13,
          color: filled ? "var(--text)" : "var(--text-muted)",
          fontStyle: filled ? "normal" : "italic",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}>
          {filled ? getLabel(field, form[field]) : "Not found"}
        </span>
      </div>
    );
  };

  // Proceed to risk analysis after document upload
  const handleProceedToRisk = () => {
    setMode("ai");
    setAiStep("review");
    loadReviewers();
  };

  // Mode selection screen
  if (mode === "choose") {
    return (
      <div className="modal-overlay open" onClick={(e) => e.target === e.currentTarget && onClose()}>
        <div className="modal" style={{ maxWidth: 720 }}>
          <div className="modal-header">
            <h2>Register AI System</h2>
            <button className="btn-close" onClick={onClose}>×</button>
          </div>
          <div className="modal-body" style={{ padding: 32 }}>
            <div style={{ textAlign: "center", marginBottom: 32 }}>
              <h3 style={{ fontSize: 20, fontWeight: 600, marginBottom: 8 }}>How would you like to register?</h3>
              <p style={{ color: "var(--text-secondary)", fontSize: 14 }}>Choose the approach that works best for you</p>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>
              <button
                onClick={startAiMode}
                style={{
                  display: "flex", flexDirection: "column", alignItems: "center", padding: 20,
                  background: "linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%)",
                  border: "2px solid #3b82f6", borderRadius: 12, cursor: "pointer",
                }}
              >
                <div style={{ width: 48, height: 48, borderRadius: "50%", background: "#3b82f6", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 12 }}>
                  <span style={{ fontSize: 20, color: "#fff" }}>✦</span>
                </div>
                <span style={{ fontSize: 15, fontWeight: 600, color: "#1e40af", marginBottom: 6 }}>AI-Assisted</span>
                <span style={{ fontSize: 12, color: "#3b82f6", textAlign: "center", lineHeight: 1.4 }}>
                  Answer guided questions
                </span>
                <Chip color="primary" size="sm" style={{ marginTop: 8 }}>RECOMMENDED</Chip>
              </button>

              <button
                onClick={() => setMode("upload")}
                style={{
                  display: "flex", flexDirection: "column", alignItems: "center", padding: 20,
                  background: "#fff", border: "1px solid var(--border)", borderRadius: 12, cursor: "pointer",
                }}
              >
                <div style={{ width: 48, height: 48, borderRadius: "50%", background: "#f0fdf4", border: "1px solid #86efac", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 12 }}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2">
                    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" strokeLinecap="round"/>
                    <path d="M14 2v6h6M12 18v-6M9 15l3-3 3 3" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </div>
                <span style={{ fontSize: 15, fontWeight: 600, color: "var(--text)", marginBottom: 6 }}>Upload Document</span>
                <span style={{ fontSize: 12, color: "var(--text-secondary)", textAlign: "center", lineHeight: 1.4 }}>
                  AI extracts from your docs
                </span>
              </button>

              <button
                onClick={() => setMode("manual")}
                style={{
                  display: "flex", flexDirection: "column", alignItems: "center", padding: 20,
                  background: "#fff", border: "1px solid var(--border)", borderRadius: 12, cursor: "pointer",
                }}
              >
                <div style={{ width: 48, height: 48, borderRadius: "50%", background: "var(--bg)", border: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 12 }}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth="2">
                    <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2" strokeLinecap="round"/>
                    <rect x="9" y="3" width="6" height="4" rx="1"/>
                    <path d="M9 12h6M9 16h6" strokeLinecap="round"/>
                  </svg>
                </div>
                <span style={{ fontSize: 15, fontWeight: 600, color: "var(--text)", marginBottom: 6 }}>Manual Form</span>
                <span style={{ fontSize: 12, color: "var(--text-secondary)", textAlign: "center", lineHeight: 1.4 }}>
                  Fill out step by step
                </span>
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // AI-assisted mode
  if (mode === "ai") {
    // Chat step
    if (aiStep === "chat") {
      const tierColors: Record<string, { bg: string; text: string }> = {
        high: { bg: "#fff7ed", text: "#ea580c" },
        limited: { bg: "#fefce8", text: "#ca8a04" },
        minimal: { bg: "#f0fdf4", text: "#16a34a" },
      };

      return (
        <div className="modal-overlay open" onClick={(e) => e.target === e.currentTarget && onClose()}>
          <div className="modal" style={{ width: 1280, maxWidth: "95vw", height: "85vh" }}>
            <div className="modal-header">
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ width: 32, height: 32, borderRadius: "50%", background: "#3b82f6", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <span style={{ color: "#fff" }}>✦</span>
                </div>
                <h2>AI-Assisted Registration</h2>
              </div>
              <button className="btn-close" onClick={onClose}>×</button>
            </div>

            <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
              {/* Chat panel - 1/3 width */}
              <div style={{ flex: 1, display: "flex", flexDirection: "column", borderRight: "1px solid var(--border)" }}>
                <div style={{ flex: 1, overflowY: "auto", padding: 20 }}>
                  {chatMessages.map((msg, i) => (
                    <div key={i} style={{ display: "flex", justifyContent: msg.role === "user" ? "flex-end" : "flex-start", marginBottom: 16 }}>
                      <div style={{
                        maxWidth: "85%", padding: "12px 16px", borderRadius: 12,
                        background: msg.role === "user" ? "#3b82f6" : "var(--bg)",
                        color: msg.role === "user" ? "#fff" : "var(--text)",
                        fontSize: 14, lineHeight: 1.6, whiteSpace: "pre-wrap",
                      }}>
                        {msg.content.split(/(\*\*[^*]+\*\*)/).map((part, j) =>
                          part.startsWith("**") && part.endsWith("**") ? (
                            <strong key={j}>{part.slice(2, -2)}</strong>
                          ) : (
                            <span key={j}>{part}</span>
                          )
                        )}
                      </div>
                    </div>
                  ))}
                  {aiThinking && (
                    <div style={{ display: "flex", justifyContent: "flex-start", marginBottom: 16 }}>
                      <div style={{ padding: "12px 16px", borderRadius: 12, background: "var(--bg)", display: "flex", alignItems: "center", gap: 8 }}>
                        <Spinner size="sm" />
                        <span style={{ color: "var(--text-secondary)", fontSize: 14 }}>
                          {isUploadingInChat ? "Analyzing document..." : "Thinking..."}
                        </span>
                      </div>
                    </div>
                  )}
                  <div ref={chatEndRef} />
                </div>

                <div style={{ padding: 16, borderTop: "1px solid var(--border)" }}>
                  {/* Uploaded documents indicator */}
                  {uploadedDocsInChat.length > 0 && (
                    <div style={{ marginBottom: 8, display: "flex", flexWrap: "wrap", gap: 4 }}>
                      {uploadedDocsInChat.map((doc, i) => (
                        <span
                          key={i}
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 4,
                            padding: "2px 8px",
                            background: doc.hasInfo ? "#f0fdf4" : "#f1f5f9",
                            border: `1px solid ${doc.hasInfo ? "#86efac" : "#e2e8f0"}`,
                            borderRadius: 4,
                            fontSize: 11,
                            color: doc.hasInfo ? "#16a34a" : "#64748b",
                          }}
                        >
                          📄 {doc.filename.length > 20 ? doc.filename.slice(0, 17) + "..." : doc.filename}
                          {doc.hasInfo && <span>✓</span>}
                        </span>
                      ))}
                    </div>
                  )}

                  <div style={{ display: "flex", gap: 8 }}>
                    {/* Hidden file input for chat uploads */}
                    <input
                      ref={chatFileInputRef}
                      type="file"
                      accept=".txt,.md,.pdf,.doc,.docx,.ppt,.pptx,.png,.jpg,.jpeg,.gif,.webp"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleChatDocumentUpload(file);
                        e.target.value = "";
                      }}
                      style={{ display: "none" }}
                    />
                    {/* Upload button */}
                    <button
                      onClick={() => chatFileInputRef.current?.click()}
                      disabled={aiThinking || isUploadingInChat}
                      title="Upload a document (PDF, Word, PowerPoint, Image)"
                      style={{
                        padding: "10px 12px",
                        background: aiThinking || isUploadingInChat ? "#f1f5f9" : "#fff",
                        border: "1px solid var(--border)",
                        borderRadius: 8,
                        fontSize: 16,
                        cursor: aiThinking || isUploadingInChat ? "not-allowed" : "pointer",
                        opacity: aiThinking || isUploadingInChat ? 0.6 : 1,
                      }}
                    >
                      📎
                    </button>
                    <input
                      ref={chatInputRef}
                      type="text"
                      value={chatInput}
                      onChange={(e) => setChatInput(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleChatSubmit()}
                      placeholder="Type or upload a document..."
                      style={{ flex: 1, padding: "10px 14px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14, outline: "none" }}
                      disabled={aiThinking || isUploadingInChat}
                      autoFocus
                    />
                    <Button color="primary" onPress={handleChatSubmit} isDisabled={!chatInput.trim() || aiThinking || isUploadingInChat}>
                      Send
                    </Button>
                  </div>
                </div>
              </div>

              {/* Status panel - 2/3 width */}
              <div style={{ flex: 2, overflowY: "auto", padding: 20, background: "var(--bg)", display: "flex", flexDirection: "column" }}>
                <ProgressIndicator />

                {/* Preliminary Risk Classification */}
                {preliminaryRisk && (
                  <div style={{
                    marginTop: 16,
                    padding: 12,
                    background: tierColors[preliminaryRisk.tier]?.bg || "#f3f4f6",
                    borderRadius: 8,
                    border: `1px solid ${tierColors[preliminaryRisk.tier]?.text || "#6b7280"}20`,
                  }}>
                    <div style={{ fontSize: 10, fontWeight: 600, color: tierColors[preliminaryRisk.tier]?.text || "#6b7280", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>
                      Preliminary Classification
                    </div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: tierColors[preliminaryRisk.tier]?.text || "#6b7280", textTransform: "capitalize" }}>
                      {preliminaryRisk.tier} Risk
                    </div>
                    <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 4 }}>
                      {preliminaryRisk.reason}
                    </div>
                  </div>
                )}

                <div style={{ marginTop: 20 }}>
                  <h4 style={{ fontSize: 11, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                    Collected Information
                  </h4>
                  <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 12, fontStyle: "italic" }}>
                    Click any field to edit directly
                  </p>
                  <EditableField field="systemName" label="System Name" />
                  <EditableField field="purpose" label="Purpose" />
                  <EditableField field="department" label="Department" />
                  <EditableField field="useCase" label="Use Case" />
                  <EditableField field="peopleAffected" label="People Affected" />
                  <EditableField field="decisionContext" label="Decision Context" />
                  <EditableField field="humanInvolvement" label="Human Involvement" />

                  {/* Registration metadata */}
                  <h4 style={{ fontSize: 11, fontWeight: 600, color: "var(--text-secondary)", marginTop: 20, marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                    Registration Details
                  </h4>
                  <EditableField field="priority" label="Priority" />
                  <EditableField field="dueDate" label="Due Date" />
                </div>

                {/* AI Disclaimer */}
                <div style={{ marginTop: "auto", paddingTop: 16 }}>
                  <div style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "10px 12px",
                    background: "var(--bg)",
                    border: "1px solid var(--border)",
                    borderRadius: 6,
                    fontSize: 11,
                    color: "var(--text-secondary)",
                    lineHeight: 1.4,
                  }}>
                    <span style={{ flexShrink: 0, opacity: 0.6 }}>ℹ</span>
                    <span>Information is generated with AI assistance. Please verify before confirming.</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="modal-footer">
              <Button variant="bordered" onPress={() => setMode("choose")}>Back</Button>
              <Button
                color="primary"
                onPress={goToReviewStep}
                isDisabled={!isComplete || aiThinking}
                title={!isComplete ? "Complete all required fields to continue" : ""}
              >
                Confirm & Continue
              </Button>
            </div>
          </div>
        </div>
      );
    }

    // Review step (skip risk analysis step - go directly here)
    if (aiStep === "review") {
      const tierColors: Record<string, { bg: string; text: string; icon: string }> = {
        high: { bg: "#fff7ed", text: "#ea580c", icon: "#ea580c" },
        limited: { bg: "#fefce8", text: "#ca8a04", icon: "#ca8a04" },
        minimal: { bg: "#f0fdf4", text: "#16a34a", icon: "#16a34a" },
      };

      const getInitials = (user: UserSummary) => {
        const first = user.firstName?.[0] || "";
        const last = user.lastName?.[0] || "";
        return (first + last).toUpperCase() || user.username.slice(0, 2).toUpperCase();
      };

      return (
        <div className="modal-overlay open" onClick={(e) => e.target === e.currentTarget && onClose()}>
          <div className="modal" style={{ width: 560, maxWidth: "95vw" }}>
            <div className="modal-header">
              <div>
                <h2 style={{ marginBottom: 4 }}>Assign reviewer</h2>
                <p style={{ fontSize: 13, color: "var(--text-secondary)", margin: 0 }}>
                  Select an AI Engineer to continue the review process.
                </p>
              </div>
              <button className="btn-close" onClick={onClose}>×</button>
            </div>

            <div className="modal-body" style={{ padding: 24 }}>
              {/* Preliminary Classification Card */}
              {preliminaryRisk && (
                <div style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 16,
                  padding: 16,
                  background: tierColors[preliminaryRisk.tier]?.bg || "#f3f4f6",
                  borderRadius: 12,
                  marginBottom: 24,
                  border: `1px solid ${tierColors[preliminaryRisk.tier]?.text || "#6b7280"}20`,
                }}>
                  <div style={{
                    width: 44,
                    height: 44,
                    borderRadius: "50%",
                    background: tierColors[preliminaryRisk.tier]?.icon || "#6b7280",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}>
                    <span style={{ color: "#fff", fontSize: 20 }}>⚠</span>
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 10, fontWeight: 600, color: tierColors[preliminaryRisk.tier]?.text || "#6b7280", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 2 }}>
                      Preliminary Classification
                    </div>
                    <div style={{ fontSize: 18, fontWeight: 700, color: tierColors[preliminaryRisk.tier]?.text || "#6b7280", textTransform: "capitalize" }}>
                      {preliminaryRisk.tier} Risk
                    </div>
                  </div>
                  <div style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "8px 12px",
                    background: "#fff",
                    borderRadius: 8,
                    fontSize: 12,
                    color: "var(--text-secondary)",
                  }}>
                    <span>📋</span>
                    <span>{preliminaryRisk.reason}</span>
                  </div>
                </div>
              )}

              {/* Description */}
              <p style={{ marginBottom: 20, color: "var(--text-secondary)", fontSize: 14, lineHeight: 1.6 }}>
                The selected AI Engineer will review <strong>{form.systemName}</strong> and finalize the risk classification.
                You'll be notified once the review is complete.
              </p>

              {/* Reviewer Selection */}
              {loadingReviewers ? (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: 32, color: "var(--text-secondary)" }}>
                  <Spinner size="sm" />
                  <span>Loading reviewers...</span>
                </div>
              ) : (
                <>
                  {/* Recommended Reviewer */}
                  {recommendedReviewers.length > 0 && (
                    <div style={{ marginBottom: 16 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                        <span style={{ fontSize: 13, fontWeight: 500, color: "var(--text)" }}>Recommended reviewer</span>
                        <span style={{
                          fontSize: 11,
                          fontWeight: 500,
                          color: "#16a34a",
                          background: "#f0fdf4",
                          padding: "2px 8px",
                          borderRadius: 4,
                        }}>Recommended</span>
                      </div>
                      {recommendedReviewers.slice(0, 1).map((reviewer) => (
                        <button
                          key={reviewer.id}
                          type="button"
                          onClick={() => setSelectedReviewer(reviewer)}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 12,
                            padding: 16,
                            background: selectedReviewer?.id === reviewer.id ? "#eff6ff" : "#fff",
                            border: selectedReviewer?.id === reviewer.id ? "2px solid #3b82f6" : "1px solid var(--border)",
                            borderRadius: 12,
                            cursor: "pointer",
                            textAlign: "left",
                            width: "100%",
                            transition: "all 0.15s",
                          }}
                        >
                          <div style={{
                            width: 40,
                            height: 40,
                            borderRadius: "50%",
                            background: "#3b82f6",
                            color: "#fff",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontWeight: 600,
                            fontSize: 14,
                          }}>
                            {getInitials(reviewer)}
                          </div>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontWeight: 600, fontSize: 15, color: "var(--text)", marginBottom: 2 }}>
                              {[reviewer.firstName, reviewer.lastName].filter(Boolean).join(" ") || reviewer.username}
                            </div>
                            <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>
                              {reviewer.department || "No department"}
                            </div>
                            <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
                              <span>👥</span>
                              <span>AI Engineers in your department</span>
                            </div>
                          </div>
                          {selectedReviewer?.id === reviewer.id && (
                            <div style={{
                              width: 28,
                              height: 28,
                              borderRadius: "50%",
                              background: "#3b82f6",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                            }}>
                              <span style={{ color: "#fff", fontSize: 14 }}>✓</span>
                            </div>
                          )}
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Divider with "Or choose different" */}
                  {(otherReviewers.length > 0 || noAIEngineersExist) && (
                    <div style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      margin: "20px 0",
                    }}>
                      <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
                      <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Or choose a different reviewer</span>
                      <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
                    </div>
                  )}

                  {/* Select different reviewer button */}
                  <button
                    type="button"
                    onClick={() => {
                      setUserSelectModalOpen(true);
                      loadAllUsers();
                    }}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      padding: "14px 16px",
                      background: "#fff",
                      border: "1px solid var(--border)",
                      borderRadius: 12,
                      cursor: "pointer",
                      textAlign: "left",
                      width: "100%",
                      transition: "all 0.15s",
                    }}
                  >
                    <div style={{
                      width: 36,
                      height: 36,
                      borderRadius: "50%",
                      background: "var(--bg)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "var(--text-secondary)",
                    }}>
                      <span style={{ fontSize: 18 }}>👤</span>
                    </div>
                    <span style={{ flex: 1, fontSize: 14, color: "var(--text)" }}>Select a different reviewer</span>
                    <span style={{ color: "var(--text-muted)", fontSize: 16 }}>›</span>
                  </button>

                  {/* Selected Reviewer Summary */}
                  {selectedReviewer && (
                    <div style={{ marginTop: 24 }}>
                      <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text)", marginBottom: 12 }}>
                        Selected reviewer
                      </div>
                      <div style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 12,
                        padding: 14,
                        background: "#f8fafc",
                        borderRadius: 10,
                        border: "1px solid var(--border)",
                      }}>
                        <div style={{
                          width: 36,
                          height: 36,
                          borderRadius: "50%",
                          background: "#3b82f6",
                          color: "#fff",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontWeight: 600,
                          fontSize: 13,
                        }}>
                          {getInitials(selectedReviewer)}
                        </div>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: 500, fontSize: 14, color: "var(--text)" }}>
                            {[selectedReviewer.firstName, selectedReviewer.lastName].filter(Boolean).join(" ") || selectedReviewer.username}
                          </div>
                          <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                            {selectedReviewer.department || "No department"} • AI Engineers in your department
                          </div>
                        </div>
                        <span style={{
                          fontSize: 11,
                          fontWeight: 500,
                          color: "#3b82f6",
                          background: "#eff6ff",
                          padding: "4px 10px",
                          borderRadius: 6,
                        }}>Selected</span>
                      </div>
                    </div>
                  )}

                  {/* Info message */}
                  <div style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    marginTop: 20,
                    padding: "12px 14px",
                    background: "#f0f9ff",
                    borderRadius: 8,
                    fontSize: 13,
                    color: "#0369a1",
                  }}>
                    <span style={{ fontSize: 16 }}>ℹ️</span>
                    <span>After submission, the reviewer will receive a task to complete the technical review.</span>
                  </div>
                </>
              )}
            </div>

            <div className="modal-footer" style={{ gap: 12 }}>
              <Button variant="bordered" onPress={() => setAiStep("chat")} style={{ minWidth: 100 }}>Back</Button>
              <Button
                variant="bordered"
                onPress={handleSaveAsDraft}
                isLoading={savingDraft}
                isDisabled={loading}
                style={{ minWidth: 140 }}
              >
                Save as Draft
              </Button>
              <Button
                color="primary"
                onPress={handleSubmit}
                isLoading={loading}
                isDisabled={(!selectedReviewer && !noAIEngineersExist) || savingDraft}
                style={{ minWidth: 180 }}
              >
                Submit for review →
              </Button>
            </div>
          </div>
        </div>
      );
    }

    // Handoff step
    if (aiStep === "handoff") {
      return (
        <div className="modal-overlay open" onClick={(e) => e.target === e.currentTarget && onClose()}>
          <div className="modal" style={{ maxWidth: 480 }}>
            <div className="modal-header">
              <h2>Registration Complete</h2>
              <button className="btn-close" onClick={onClose}>×</button>
            </div>

            <div className="modal-body" style={{ padding: 24 }}>
              <div style={{ textAlign: "center", marginBottom: 24 }}>
                <div style={{
                  width: 64, height: 64, borderRadius: "50%", background: "#f0fdf4",
                  display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px",
                }}>
                  <span style={{ fontSize: 32, color: "#16a34a" }}>✓</span>
                </div>
                <h3 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>{form.systemName}</h3>
                <p style={{ color: "var(--text-secondary)", fontSize: 14 }}>
                  System ID: <strong>{registeredId}</strong>
                </p>
              </div>

              <div className="msg-strip info">
                <div>
                  <h4 style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>What happens next?</h4>
                  <ol style={{ margin: 0, paddingLeft: 20, fontSize: 13, lineHeight: 1.8 }}>
                    <li>AI Engineer reviews and finalizes classification</li>
                    <li>Compliance obligations are generated</li>
                    <li>You will be notified when complete</li>
                  </ol>
                </div>
              </div>
            </div>

            <div className="modal-footer">
              <Button color="primary" onPress={() => { onSuccess(); onClose(); }}>Done</Button>
            </div>
          </div>
        </div>
      );
    }
  }

  // Upload document mode
  if (mode === "upload") {
    const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      setUploadedFile(file);
      setLoading(true);
      setUploadAnalysis(null);

      try {
        const result = await api.analyzeDocument(file);
        setUploadAnalysis(result.content);

        // Apply extracted data to form
        if (result.extracted) {
          const extracted: Partial<AppOwnerFormData> = {};
          if (result.extracted.systemName) extracted.systemName = result.extracted.systemName;
          if (result.extracted.purpose) extracted.purpose = result.extracted.purpose;
          if (result.extracted.department) extracted.department = result.extracted.department;
          if (result.extracted.useCase && USE_CASES.some(u => u.value === result.extracted!.useCase)) {
            extracted.useCase = result.extracted.useCase as AppOwnerFormData["useCase"];
          }
          if (result.extracted.peopleAffected && PEOPLE_AFFECTED.some(p => p.value === result.extracted!.peopleAffected)) {
            extracted.peopleAffected = result.extracted.peopleAffected as AppOwnerFormData["peopleAffected"];
          }
          if (result.extracted.decisionContext && ["supports", "influences", "automates"].includes(result.extracted.decisionContext)) {
            extracted.decisionContext = result.extracted.decisionContext as AppOwnerFormData["decisionContext"];
          }
          if (result.extracted.humanInvolvement && ["ai_decides", "ai_recommends", "human_decides"].includes(result.extracted.humanInvolvement)) {
            extracted.humanInvolvement = result.extracted.humanInvolvement as AppOwnerFormData["humanInvolvement"];
          }
          setForm(f => ({ ...f, ...extracted }));
        }
      } catch (err) {
        showToast(`Failed to analyze document: ${(err as Error).message}`, true);
      } finally {
        setLoading(false);
      }
    };

    return (
      <div className="modal-overlay open" onClick={(e) => e.target === e.currentTarget && onClose()}>
        <div className="modal" style={{ maxWidth: 700 }}>
          <div className="modal-header">
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ width: 32, height: 32, borderRadius: "50%", background: "#f0fdf4", border: "1px solid #86efac", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2">
                  <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" strokeLinecap="round"/>
                  <path d="M14 2v6h6M12 18v-6M9 15l3-3 3 3" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
              <h2>Upload System Documentation</h2>
            </div>
            <button className="btn-close" onClick={onClose}>×</button>
          </div>

          <div className="modal-body" style={{ padding: 24 }}>
            {!uploadedFile ? (
              <div
                onClick={() => fileInputRef.current?.click()}
                style={{
                  border: "2px dashed var(--border)",
                  borderRadius: 12,
                  padding: 40,
                  textAlign: "center",
                  cursor: "pointer",
                  transition: "border-color 0.2s, background 0.2s",
                }}
                onDragOver={(e) => { e.preventDefault(); e.currentTarget.style.borderColor = "#3b82f6"; e.currentTarget.style.background = "#eff6ff"; }}
                onDragLeave={(e) => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.background = "transparent"; }}
                onDrop={(e) => {
                  e.preventDefault();
                  e.currentTarget.style.borderColor = "var(--border)";
                  e.currentTarget.style.background = "transparent";
                  const file = e.dataTransfer.files[0];
                  if (file) {
                    const input = fileInputRef.current;
                    if (input) {
                      const dt = new DataTransfer();
                      dt.items.add(file);
                      input.files = dt.files;
                      input.dispatchEvent(new Event("change", { bubbles: true }));
                    }
                  }
                }}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".txt,.md,.pdf,.doc,.docx,.ppt,.pptx,.png,.jpg,.jpeg,.gif,.webp"
                  onChange={handleFileSelect}
                  style={{ display: "none" }}
                />
                <div style={{ width: 64, height: 64, borderRadius: "50%", background: "var(--bg)", margin: "0 auto 16px", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth="1.5">
                    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </div>
                <p style={{ fontSize: 16, fontWeight: 600, color: "var(--text)", marginBottom: 8 }}>
                  Drop your document here or click to browse
                </p>
                <p style={{ fontSize: 13, color: "var(--text-secondary)" }}>
                  PDF, Word, PowerPoint, Markdown, Images
                </p>
              </div>
            ) : loading ? (
              <div style={{ textAlign: "center", padding: 40 }}>
                <Spinner size="lg" />
                <p style={{ marginTop: 16, color: "var(--text-secondary)" }}>Analyzing document...</p>
              </div>
            ) : (
              <>
                <div style={{ display: "flex", alignItems: "center", gap: 12, padding: 16, background: "#f0fdf4", borderRadius: 8, marginBottom: 20 }}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2">
                    <circle cx="12" cy="12" r="10"/>
                    <path d="M9 12l2 2 4-4" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, color: "#16a34a" }}>{uploadedFile.name}</div>
                    <div style={{ fontSize: 12, color: "#15803d" }}>Document analyzed successfully</div>
                  </div>
                  <Button size="sm" variant="light" onPress={() => { setUploadedFile(null); setUploadAnalysis(null); setForm(EMPTY_FORM); }}>
                    Change file
                  </Button>
                </div>

                {uploadAnalysis && (
                  <div style={{ background: "var(--bg)", borderRadius: 8, padding: 16, marginBottom: 20, fontSize: 14, lineHeight: 1.6 }}>
                    <h4 style={{ fontSize: 13, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                      Analysis Summary
                    </h4>
                    <p style={{ color: "var(--text)", whiteSpace: "pre-wrap" }}>{uploadAnalysis}</p>
                  </div>
                )}

                <ProgressIndicator />

                <div style={{ marginTop: 16 }}>
                  <h4 style={{ fontSize: 13, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                    Extracted Information
                  </h4>
                  <FieldStatus field="systemName" label="System Name" />
                  <FieldStatus field="purpose" label="Purpose" />
                  <FieldStatus field="department" label="Department" />
                  <FieldStatus field="useCase" label="Use Case" />
                  <FieldStatus field="peopleAffected" label="People Affected" />
                  <FieldStatus field="decisionContext" label="Decision Context" />
                  <FieldStatus field="humanInvolvement" label="Human Involvement" />
                </div>

                {!isComplete && (
                  <div className="msg-strip info" style={{ marginTop: 16 }}>
                    <span>ℹ</span>
                    <span>Some fields couldn't be extracted. You can complete them in the AI chat or manual form.</span>
                  </div>
                )}
              </>
            )}
          </div>

          <div className="modal-footer">
            <Button variant="bordered" onPress={() => setMode("choose")}>Back</Button>
            {uploadedFile && !loading && (
              <>
                {!isComplete ? (
                  <Button color="primary" onPress={() => { setMode("ai"); setAiStep("chat"); startAiMode(); }}>
                    Complete with AI Chat
                  </Button>
                ) : (
                  <Button color="primary" onPress={handleProceedToRisk}>
                    Analyze Risk & Continue
                  </Button>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Manual mode
  if (mode === "manual") {
    const manualSteps = ["Basic Info", "Context", "Decisions", "Review"];

    const setField = (field: keyof AppOwnerFormData, value: string) => {
      setForm((f) => ({ ...f, [field]: value }));
    };

    const canProceed = () => {
      if (manualStep === 0) return form.systemName.trim() !== "" && form.purpose.trim() !== "";
      if (manualStep === 1) return form.department.trim() !== "" && form.useCase !== "";
      if (manualStep === 2) return form.decisionContext !== "" && form.humanInvolvement !== "" && form.peopleAffected !== "";
      return true;
    };

    return (
      <div className="modal-overlay open" onClick={(e) => e.target === e.currentTarget && onClose()}>
        <div className="modal" style={{ maxWidth: 600 }}>
          <div className="modal-header">
            <h2>Register AI System</h2>
            <button className="btn-close" onClick={onClose}>×</button>
          </div>

          {/* Step indicator */}
          <div className="wizard-steps">
            {manualSteps.map((s, i) => (
              <div key={i} className={`wizard-step ${i === manualStep ? "active" : ""} ${i < manualStep ? "done" : ""}`}>
                <span className="step-num">{i < manualStep ? "✓" : i + 1}</span>
                {s}
              </div>
            ))}
          </div>

          <div className="modal-body" style={{ padding: 24 }}>
            {manualStep === 0 && (
              <div className="form-grid single">
                <div className="form-group">
                  <label className="required">System Name</label>
                  <input type="text" value={form.systemName} onChange={(e) => setField("systemName", e.target.value)}
                    placeholder="e.g., TalentMatch Recruiting Assistant" />
                </div>
                <div className="form-group">
                  <label className="required">Purpose</label>
                  <textarea value={form.purpose} onChange={(e) => setField("purpose", e.target.value)}
                    placeholder="What does this AI system do?" />
                </div>
              </div>
            )}

            {manualStep === 1 && (
              <div className="form-grid single">
                <div className="form-group">
                  <label className="required">Department</label>
                  <input type="text" value={form.department} onChange={(e) => setField("department", e.target.value)}
                    placeholder="e.g., Human Resources" />
                </div>
                <div className="form-group">
                  <label className="required">Use Case</label>
                  <select className="form-select" value={form.useCase} onChange={(e) => setField("useCase", e.target.value)}>
                    <option value="">Select use case...</option>
                    {USE_CASES.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
                  </select>
                </div>
              </div>
            )}

            {manualStep === 2 && (
              <div className="form-grid single">
                <div className="form-group">
                  <label className="required">People Affected</label>
                  <select className="form-select" value={form.peopleAffected} onChange={(e) => setField("peopleAffected", e.target.value)}>
                    <option value="">Select who is affected...</option>
                    {PEOPLE_AFFECTED.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label className="required">Decision Context</label>
                  <select className="form-select" value={form.decisionContext} onChange={(e) => setField("decisionContext", e.target.value as AppOwnerFormData["decisionContext"])}>
                    <option value="">Select how AI influences decisions...</option>
                    {DECISION_CONTEXT.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label className="required">Human Involvement</label>
                  <select className="form-select" value={form.humanInvolvement} onChange={(e) => setField("humanInvolvement", e.target.value as AppOwnerFormData["humanInvolvement"])}>
                    <option value="">Select level of human oversight...</option>
                    {HUMAN_INVOLVEMENT.map((h) => <option key={h.value} value={h.value}>{h.label}</option>)}
                  </select>
                </div>
              </div>
            )}

            {manualStep === 3 && (
              <div>
                <p style={{ marginBottom: 16, color: "var(--text-secondary)" }}>Please review the information below.</p>
                <div style={{ background: "var(--bg)", borderRadius: 8, padding: 16 }}>
                  {[
                    { label: "System Name", value: form.systemName },
                    { label: "Purpose", value: form.purpose },
                    { label: "Department", value: form.department },
                    { label: "Use Case", value: getLabel("useCase", form.useCase) },
                    { label: "People Affected", value: getLabel("peopleAffected", form.peopleAffected) },
                    { label: "Decision Context", value: getLabel("decisionContext", form.decisionContext) },
                    { label: "Human Involvement", value: getLabel("humanInvolvement", form.humanInvolvement) },
                  ].map((item, i) => (
                    <div key={i} style={{ display: "flex", padding: "8px 0", borderBottom: i < 6 ? "1px solid var(--border)" : "none" }}>
                      <span style={{ width: 140, flexShrink: 0, fontSize: 13, color: "var(--text-secondary)" }}>{item.label}</span>
                      <span style={{ fontSize: 14, color: "var(--text)" }}>{item.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="modal-footer">
            <Button variant="bordered" onPress={() => manualStep === 0 ? setMode("choose") : setManualStep((s) => s - 1)}>
              {manualStep === 0 ? "Back" : "Previous"}
            </Button>
            {manualStep < 3 ? (
              <Button color="primary" onPress={() => setManualStep((s) => s + 1)} isDisabled={!canProceed()}>
                Next
              </Button>
            ) : (
              <Button color="primary" onPress={handleSubmit} isLoading={loading}>
                Submit Registration
              </Button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // User Selection Modal (for manual reviewer override)
  if (userSelectModalOpen) {
    return (
      <div className="modal-overlay open" onClick={(e) => e.target === e.currentTarget && setUserSelectModalOpen(false)}>
        <div className="modal" style={{ maxWidth: 500 }}>
          <div className="modal-header">
            <h2>{noAIEngineersExist ? "Select Reviewer" : "Select AI Engineer"}</h2>
            <button className="btn-close" onClick={() => setUserSelectModalOpen(false)}>×</button>
          </div>

          <div className="modal-body" style={{ padding: 0 }}>
            {loadingAllUsers ? (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 32 }}>
                <Spinner size="lg" />
              </div>
            ) : allUsers.length === 0 ? (
              <div style={{ textAlign: "center", padding: 32, color: "var(--text-secondary)" }}>
                No users available
              </div>
            ) : (
              <div style={{ maxHeight: 400, overflowY: "auto" }}>
                {allUsers.map((user) => (
                  <button
                    key={user.id}
                    type="button"
                    onClick={() => {
                      setSelectedReviewer(user);
                      setUserSelectModalOpen(false);
                    }}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      padding: "12px 16px",
                      background: selectedReviewer?.id === user.id ? "var(--primary-bg)" : "transparent",
                      border: "none",
                      borderBottom: "1px solid var(--border)",
                      cursor: "pointer",
                      textAlign: "left",
                      width: "100%",
                      transition: "background 0.15s",
                    }}
                    onMouseEnter={(e) => {
                      if (selectedReviewer?.id !== user.id) {
                        e.currentTarget.style.background = "var(--bg)";
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (selectedReviewer?.id !== user.id) {
                        e.currentTarget.style.background = "transparent";
                      }
                    }}
                  >
                    <Avatar
                      name={[user.firstName, user.lastName].filter(Boolean).join(" ") || user.username}
                      size="sm"
                      style={{ background: user.roles.includes("ai_engineer") ? "#3b82f6" : "#64748b", color: "#fff" }}
                    />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 500, fontSize: 14, color: "var(--text)" }}>
                        {[user.firstName, user.lastName].filter(Boolean).join(" ") || user.username}
                      </div>
                      <div style={{ fontSize: 12, color: "var(--text-secondary)", display: "flex", gap: 8, alignItems: "center" }}>
                        <span>{user.department || "No department"}</span>
                        {user.roles.includes("ai_engineer") && (
                          <Chip size="sm" color="primary" variant="flat" style={{ fontSize: 10, height: 18 }}>
                            AI Engineer
                          </Chip>
                        )}
                      </div>
                    </div>
                    {selectedReviewer?.id === user.id && (
                      <span style={{ color: "var(--primary)", fontSize: 18 }}>✓</span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="modal-footer">
            <Button variant="bordered" onPress={() => setUserSelectModalOpen(false)}>
              Cancel
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return null;
}
