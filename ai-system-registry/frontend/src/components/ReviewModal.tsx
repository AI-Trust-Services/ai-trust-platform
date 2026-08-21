import { useState, useEffect, useRef } from "react";
import { Spinner, Button, Checkbox } from "@heroui/react";
import { TierBadge, FormattedDate } from "./Badges";
import { api, type ActivityEntry, type SystemDocument, type FieldSuggestion, type ConflictingSuggestion } from "../api/client";
import { useToast } from "../App";
import type { AISystem } from "../types";
import { TECH_REVIEW_FLOW, formatConfirmation, parseUserInput, type Question } from "../config/chatFlows";
import ChatFlowUI, { type FieldConfig } from "./ChatFlowUI";
import { useChatFlow } from "../hooks/useChatFlow";

// AI suggestion type for inline display
interface AiFieldSuggestion {
  value: boolean;
  reason: string;
}

interface AiSuggestionsMap {
  is_gpai?: AiFieldSuggestion;
  is_chatbot?: AiFieldSuggestion;
  generates_synthetic_content?: AiFieldSuggestion;
  is_biometric_identification?: AiFieldSuggestion;
  is_critical_infrastructure?: AiFieldSuggestion;
}

// Technical review fields that AI can fill
interface TechReviewForm {
  provider: string;
  version: string;
  application_url: string;
  is_gpai: boolean;
  training_compute_flops: number;
  is_chatbot: boolean;
  generates_synthetic_content: boolean;
  subliminal_manipulation: boolean;
  exploits_vulnerability: boolean;
  social_scoring_public: boolean;
  real_time_biometric_public: boolean;
  emotion_recognition_workplace: boolean;
  untargeted_facial_scraping: boolean;
  predictive_policing: boolean;
  biometric_categorisation_sensitive: boolean;
  is_biometric_identification: boolean;
  is_critical_infrastructure: boolean;
}

// Field configuration for ChatFlowUI - derived from TECH_REVIEW_FLOW
const TECH_FIELD_CONFIGS: FieldConfig[] = TECH_REVIEW_FLOW.questions.map((q) => ({
  field: q.field,
  label: q.field
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace("Is ", "")
    .replace("Generates ", ""),
  type: q.type === "boolean" ? "boolean" : "text",
}));

interface Props {
  system: AISystem | null;
  onClose: () => void;
  onReviewComplete: () => void;
  onDataChange?: () => void; // Called when technical data is saved (to refresh parent's list)
}

// Inline suggestion component
function AiSuggestion({
  suggestion,
  currentValue,
  onApply,
}: {
  suggestion: AiFieldSuggestion;
  currentValue: boolean;
  onApply: () => void;
}) {
  const matches = currentValue === suggestion.value;

  if (matches) {
    return (
      <span style={suggestionMatchStyle}>
        <span style={{ fontSize: 12, color: "#059669" }}>✓ {suggestion.reason.slice(0, 60)}</span>
      </span>
    );
  }

  return (
    <span style={suggestionBadgeStyle}>
      <span style={{ fontSize: 12 }}>✨ Suggest: <strong>{suggestion.value ? "Yes" : "No"}</strong></span>
      <span style={{ fontSize: 11, color: "#6b7280", marginLeft: 4 }}>— {suggestion.reason.slice(0, 40)}</span>
      <button onClick={onApply} style={applySuggestionButtonStyle}>Apply</button>
    </span>
  );
}

// Field display names for the suggestions UI
const FIELD_LABELS: Record<string, string> = {
  provider: "Provider/Vendor",
  version: "Version",
  application_url: "Application URL",
  is_gpai: "General Purpose AI (GPAI)",
  training_compute_flops: "Training Compute (FLOPS)",
  is_chatbot: "Is a Chatbot",
  generates_synthetic_content: "Generates Synthetic Content",
  is_biometric_identification: "Biometric Identification",
  is_critical_infrastructure: "Critical Infrastructure",
  subliminal_manipulation: "Subliminal Manipulation",
  exploits_vulnerability: "Exploits Vulnerability",
  social_scoring_public: "Social Scoring (Public)",
  real_time_biometric_public: "Real-time Biometric (Public)",
  emotion_recognition_workplace: "Emotion Recognition (Workplace)",
  untargeted_facial_scraping: "Untargeted Facial Scraping",
  predictive_policing: "Predictive Policing",
  biometric_categorisation_sensitive: "Biometric Categorisation (Sensitive)",
};

// Format a field value for display
function formatFieldValue(value: unknown): string {
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return value.toLocaleString();
  if (value === null || value === undefined) return "—";
  return String(value);
}

// SuggestionsReview component for reviewing pre-filled values from documents
function SuggestionsReview({
  suggestions,
  conflicts,
  summaryMessage,
  confirmedFields,
  resolvedConflicts,
  techForm,
  onConfirm,
  onReject,
  onResolveConflict,
  onConfirmAll,
  onSwitchToManual,
}: {
  suggestions: FieldSuggestion[];
  conflicts: ConflictingSuggestion[];
  summaryMessage: string;
  confirmedFields: Set<string>;
  resolvedConflicts: Record<string, unknown>;
  techForm: TechReviewForm;
  onConfirm: (field: string) => void;
  onReject: (field: string) => void;
  onResolveConflict: (field: string, value: unknown) => void;
  onConfirmAll: () => void;
  onSwitchToManual: () => void;
}) {
  const pendingSuggestions = suggestions.filter(s => !confirmedFields.has(s.field));
  const confirmedSuggestions = suggestions.filter(s => confirmedFields.has(s.field));
  const allConfirmed = pendingSuggestions.length === 0 && conflicts.length === 0;

  return (
    <div style={{ padding: 20, maxWidth: 800, margin: "0 auto" }}>
      {/* AI Message Header */}
      <div style={{
        background: "linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%)",
        border: "1px solid #bbf7d0",
        borderRadius: 12,
        padding: 16,
        marginBottom: 24,
        display: "flex",
        gap: 12,
        alignItems: "flex-start",
      }}>
        <div style={{
          width: 40, height: 40, borderRadius: "50%", background: "#22c55e",
          display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
        }}>
          <span style={{ fontSize: 20, color: "#fff" }}>✦</span>
        </div>
        <div>
          <p style={{ margin: 0, color: "#166534", fontWeight: 500, marginBottom: 4 }}>
            {summaryMessage}
          </p>
          <p style={{ margin: 0, fontSize: 13, color: "#15803d" }}>
            Review each field below and confirm or change the suggested values.
          </p>
        </div>
      </div>

      {/* Pending Suggestions */}
      {pendingSuggestions.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <h4 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: "#374151" }}>
              Suggested Values ({pendingSuggestions.length})
            </h4>
            <button
              onClick={onConfirmAll}
              style={{
                background: "#22c55e", color: "#fff", border: "none", borderRadius: 6,
                padding: "6px 12px", fontSize: 13, fontWeight: 500, cursor: "pointer",
              }}
            >
              ✓ Confirm All
            </button>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {pendingSuggestions.map(suggestion => (
              <div
                key={suggestion.field}
                style={{
                  background: "#fff", border: "1px solid #e5e7eb", borderRadius: 8,
                  padding: 12, display: "flex", justifyContent: "space-between", alignItems: "center",
                }}
              >
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 500, color: "#111827", marginBottom: 4 }}>
                    {FIELD_LABELS[suggestion.field] || suggestion.field}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{
                      background: typeof suggestion.value === "boolean"
                        ? (suggestion.value ? "#dcfce7" : "#fef2f2")
                        : "#f3f4f6",
                      color: typeof suggestion.value === "boolean"
                        ? (suggestion.value ? "#166534" : "#991b1b")
                        : "#374151",
                      padding: "2px 8px", borderRadius: 4, fontSize: 13, fontWeight: 500,
                    }}>
                      {formatFieldValue(suggestion.value)}
                    </span>
                    <span style={{ fontSize: 12, color: "#6b7280" }}>
                      from "{suggestion.source_document}"
                    </span>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    onClick={() => onConfirm(suggestion.field)}
                    style={{
                      background: "#22c55e", color: "#fff", border: "none", borderRadius: 6,
                      padding: "6px 16px", fontSize: 13, fontWeight: 500, cursor: "pointer",
                    }}
                  >
                    ✓ Confirm
                  </button>
                  <button
                    onClick={() => onReject(suggestion.field)}
                    style={{
                      background: "#fff", color: "#6b7280", border: "1px solid #d1d5db", borderRadius: 6,
                      padding: "6px 12px", fontSize: 13, cursor: "pointer",
                    }}
                  >
                    Change
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Conflicts - Need User Clarification */}
      {conflicts.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <h4 style={{ margin: 0, marginBottom: 12, fontSize: 14, fontWeight: 600, color: "#dc2626" }}>
            ⚠️ Needs Clarification ({conflicts.length})
          </h4>

          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {conflicts.map(conflict => (
              <div
                key={conflict.field}
                style={{
                  background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 8,
                  padding: 16,
                }}
              >
                <div style={{ fontWeight: 500, color: "#92400e", marginBottom: 8 }}>
                  {FIELD_LABELS[conflict.field] || conflict.field}
                </div>
                <p style={{ margin: 0, marginBottom: 12, fontSize: 13, color: "#b45309" }}>
                  Different documents suggest different values. Please select the correct one:
                </p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {conflict.suggestions.map((s, idx) => (
                    <button
                      key={idx}
                      onClick={() => onResolveConflict(conflict.field, s.value)}
                      style={{
                        background: "#fff", border: "1px solid #d1d5db", borderRadius: 6,
                        padding: "8px 16px", cursor: "pointer", textAlign: "left",
                      }}
                    >
                      <div style={{ fontWeight: 500, color: "#111827", marginBottom: 2 }}>
                        {formatFieldValue(s.value)}
                      </div>
                      <div style={{ fontSize: 11, color: "#6b7280" }}>
                        from "{s.source_document}"
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Confirmed Fields */}
      {confirmedSuggestions.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <h4 style={{ margin: 0, marginBottom: 12, fontSize: 14, fontWeight: 600, color: "#059669" }}>
            ✓ Confirmed ({confirmedSuggestions.length})
          </h4>

          <div style={{
            display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 8,
          }}>
            {confirmedSuggestions.map(suggestion => (
              <div
                key={suggestion.field}
                style={{
                  background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 6,
                  padding: 8, fontSize: 13,
                }}
              >
                <span style={{ color: "#166534", fontWeight: 500 }}>
                  {FIELD_LABELS[suggestion.field] || suggestion.field}:
                </span>{" "}
                <span style={{ color: "#15803d" }}>{formatFieldValue(techForm[suggestion.field as keyof TechReviewForm])}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Footer Actions */}
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        paddingTop: 16, borderTop: "1px solid #e5e7eb",
      }}>
        <button
          onClick={onSwitchToManual}
          style={{
            background: "transparent", color: "#6b7280", border: "none",
            padding: "8px 0", fontSize: 13, cursor: "pointer", textDecoration: "underline",
          }}
        >
          Switch to manual form
        </button>

        {allConfirmed && (
          <div style={{
            background: "#dcfce7", color: "#166534", padding: "8px 16px",
            borderRadius: 6, fontSize: 13, fontWeight: 500,
          }}>
            ✓ All fields confirmed! Click "Save Technical Data" below to save.
          </div>
        )}
      </div>
    </div>
  );
}

export default function ReviewModal({ system, onClose, onReviewComplete, onDataChange }: Props) {
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [comment, setComment] = useState("");
  const [activeTab, setActiveTab] = useState<"overview" | "technical">("overview");
  const [techSaved, setTechSaved] = useState(false);
  const [aiAssisting, setAiAssisting] = useState(false);
  const [aiSuggestions, setAiSuggestions] = useState<AiSuggestionsMap | null>(null);
  const [documents, setDocuments] = useState<SystemDocument[]>([]);
  const [uploading, setUploading] = useState(false);
  const [docType, setDocType] = useState<string>("technical_spec");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const showToast = useToast();

  // AI Chat mode state
  const [techMode, setTechMode] = useState<"choose" | "ai" | "manual" | "suggestions">("choose");
  const [isUploadingDoc, setIsUploadingDoc] = useState(false);
  const [uploadedDocs, setUploadedDocs] = useState<{ filename: string; hasInfo: boolean }[]>([]);

  // Field suggestions from previously analyzed documents
  const [fieldSuggestions, setFieldSuggestions] = useState<FieldSuggestion[]>([]);
  const [fieldConflicts, setFieldConflicts] = useState<ConflictingSuggestion[]>([]);
  const [suggestionsSummary, setSuggestionsSummary] = useState<string>("");
  const [confirmedFields, setConfirmedFields] = useState<Set<string>>(new Set());
  const [resolvedConflicts, setResolvedConflicts] = useState<Record<string, unknown>>({});

  // Initial tech form values
  const getInitialTechForm = (sys: AISystem | null): Record<string, unknown> => ({
    provider: sys?.provider || "",
    version: sys?.version || "",
    application_url: sys?.application_url || "",
    is_gpai: sys?.is_gpai || false,
    training_compute_flops: sys?.training_compute_flops || 0,
    is_chatbot: sys?.is_chatbot || false,
    generates_synthetic_content: sys?.generates_synthetic_content || false,
    subliminal_manipulation: sys?.subliminal_manipulation || false,
    exploits_vulnerability: sys?.exploits_vulnerability || false,
    social_scoring_public: sys?.social_scoring_public || false,
    real_time_biometric_public: sys?.real_time_biometric_public || false,
    emotion_recognition_workplace: sys?.emotion_recognition_workplace || false,
    untargeted_facial_scraping: sys?.untargeted_facial_scraping || false,
    predictive_policing: sys?.predictive_policing || false,
    biometric_categorisation_sensitive: sys?.biometric_categorisation_sensitive || false,
    is_biometric_identification: sys?.is_biometric_identification || false,
    is_critical_infrastructure: sys?.is_critical_infrastructure || false,
  });

  // Use the chat flow hook for AI-assisted mode
  const chatFlow = useChatFlow({
    flow: TECH_REVIEW_FLOW,
    context: {
      systemName: system?.name || "",
      description: system?.description || "",
      intendedPurpose: system?.intended_purpose || "",
      organization: system?.org_name || "",
      currentTier: system?.tier || "",
    },
    initialForm: getInitialTechForm(system),
    // Data comes from database, so boolean false values are real answers (not defaults)
    treatFalseAsAnswered: true,
    onFormChange: (newForm) => {
      // Sync with local techForm for the manual mode and save functionality
      setTechForm(newForm as typeof techForm);
    },
  });

  // Editable technical fields (used for both manual and AI mode)
  const [techForm, setTechForm] = useState(getInitialTechForm(null) as TechReviewForm);

  // Load data when system changes
  useEffect(() => {
    if (system) {
      setLoading(true);
      setAiSuggestions(null);
      setDocuments([]);
      setTechSaved(false);
      setComment("");
      setActiveTab("overview");
      setTechMode("choose");
      setIsUploadingDoc(false);
      setUploadedDocs([]);
      setFieldSuggestions([]);
      setFieldConflicts([]);
      setSuggestionsSummary("");
      setConfirmedFields(new Set());
      setResolvedConflicts({});
      chatFlow.reset();

      Promise.all([
        api.getSystemActivity(system.id).catch(() => []),
        api.getDocuments(system.id).catch(() => []),
        api.getFieldSuggestions(system.id, "technical_review").catch(() => ({ suggestions: [], conflicts: [], summary_message: "" })),
      ]).then(([activityData, docsData, suggestionsData]) => {
        setActivity(activityData);
        setDocuments(docsData);
        setFieldSuggestions(suggestionsData.suggestions);
        setFieldConflicts(suggestionsData.conflicts);
        setSuggestionsSummary(suggestionsData.summary_message);
      }).finally(() => setLoading(false));

      setTechForm(getInitialTechForm(system) as TechReviewForm);
    }
  }, [system]);

  // Handle document upload in AI chat mode
  const handleTechDocumentUpload = async (file: File) => {
    if (!system) return;
    setIsUploadingDoc(true);

    // Add user message showing upload
    chatFlow.messages.push({ role: "user", content: `📄 Uploading: ${file.name}` });

    try {
      const result = await api.analyzeDocument(file, {
        contextType: "technical_review",
        systemName: system.name,
        systemDescription: system.description,
        currentForm: techForm,
      });

      // Track uploaded document
      setUploadedDocs((docs) => [
        ...docs,
        { filename: file.name, hasInfo: result.has_extractable_info },
      ]);

      // Apply extracted data to form
      if (result.extracted) {
        const updates: Partial<TechReviewForm> = {};
        if (result.extracted.provider) updates.provider = String(result.extracted.provider);
        if (result.extracted.version) updates.version = String(result.extracted.version);
        if (result.extracted.application_url) updates.application_url = String(result.extracted.application_url);
        if (typeof result.extracted.is_gpai === "boolean") updates.is_gpai = result.extracted.is_gpai;
        if (typeof result.extracted.is_chatbot === "boolean") updates.is_chatbot = result.extracted.is_chatbot;
        if (typeof result.extracted.generates_synthetic_content === "boolean") updates.generates_synthetic_content = result.extracted.is_chatbot;
        if (typeof result.extracted.is_biometric_identification === "boolean") updates.is_biometric_identification = result.extracted.is_biometric_identification;
        if (typeof result.extracted.is_critical_infrastructure === "boolean") updates.is_critical_infrastructure = result.extracted.is_critical_infrastructure;
        if (result.extracted.training_compute_flops) updates.training_compute_flops = Number(result.extracted.training_compute_flops);

        setTechForm((f) => ({ ...f, ...updates }));
        // Also update the chatFlow form
        Object.entries(updates).forEach(([key, value]) => {
          chatFlow.updateField(key, value);
        });
      }

      // Add AI response
      let responseContent = result.content;
      const fieldsExtracted = result.extracted ? Object.keys(result.extracted).length : 0;
      if (fieldsExtracted > 0) {
        responseContent += `\n\nI've extracted ${fieldsExtracted} technical field(s) from your document.`;
      }
      if (!result.has_extractable_info) {
        responseContent += "\n\nI couldn't find technical details in this document. Feel free to upload another document or continue with the questions.";
      }

      chatFlow.messages.push({ role: "assistant", content: responseContent });

      // If extractable info was found, attach the document to the system
      if (result.has_extractable_info) {
        try {
          const doc = await api.uploadDocument(system.id, file, "technical_spec", "Uploaded during technical review - analyzed for field extraction");
          setDocuments(prev => [doc, ...prev]);
          chatFlow.messages.push({
            role: "assistant",
            content: `✅ I've attached "${file.name}" to the system registry for documentation.`,
          });
        } catch (attachErr) {
          // Don't fail the whole flow if attachment fails
          console.error("Failed to attach document:", attachErr);
        }
      }
    } catch (error) {
      chatFlow.messages.push({
        role: "assistant",
        content: `Sorry, I couldn't analyze that document: ${(error as Error).message}. Please try a different file or continue with the questions.`,
      });
    } finally {
      setIsUploadingDoc(false);
    }
  };

  // Start AI-assisted technical review
  const startAiTechMode = () => {
    setTechMode("ai");
    chatFlow.reset();
    // Small delay to ensure state is reset before starting
    setTimeout(() => chatFlow.start(), 50);
  };

  // AI Assistance handler (for manual mode)
  const handleAiAssist = async () => {
    if (!system) return;
    setAiAssisting(true);
    setAiSuggestions(null);
    try {
      const result = await api.assistTechnicalReview({
        name: system.name,
        description: system.description,
        intended_purpose: system.intended_purpose,
        org_name: system.org_name,
        tier: system.tier,
        provider: techForm.provider,
        version: techForm.version,
        is_gpai: techForm.is_gpai,
        is_chatbot: techForm.is_chatbot,
        generates_synthetic_content: techForm.generates_synthetic_content,
      });

      if (result.suggestions && typeof result.suggestions === 'object') {
        const suggestions: AiSuggestionsMap = {};
        const raw = result.suggestions as Record<string, { value: boolean; reason: string }>;

        if (raw.is_gpai) suggestions.is_gpai = { value: raw.is_gpai.value, reason: raw.is_gpai.reason };
        if (raw.is_chatbot) suggestions.is_chatbot = { value: raw.is_chatbot.value, reason: raw.is_chatbot.reason };
        if (raw.generates_synthetic_content) suggestions.generates_synthetic_content = { value: raw.generates_synthetic_content.value, reason: raw.generates_synthetic_content.reason };
        if (raw.is_biometric_identification) suggestions.is_biometric_identification = { value: raw.is_biometric_identification.value, reason: raw.is_biometric_identification.reason };
        if (raw.is_critical_infrastructure) suggestions.is_critical_infrastructure = { value: raw.is_critical_infrastructure.value, reason: raw.is_critical_infrastructure.reason };

        setAiSuggestions(Object.keys(suggestions).length > 0 ? suggestions : null);
        if (Object.keys(suggestions).length > 0) {
          showToast("AI suggestions ready - click 'Apply' next to each field to use them");
        } else {
          showToast("AI analyzed the system but couldn't determine specific suggestions", true);
        }
      } else {
        showToast("AI analyzed the system but couldn't determine specific suggestions", true);
      }
    } catch (e) {
      showToast(`AI assistance failed: ${(e as Error).message}`, true);
    } finally {
      setAiAssisting(false);
    }
  };

  const handleSaveTechnical = async () => {
    if (!system) return;
    setSubmitting(true);
    try {
      await api.updateSystem(system.id, techForm);
      setTechSaved(true);
      showToast("Technical details saved — you can now complete the review");
      setActiveTab("overview");
      // Notify parent to refresh data so reopening shows updated values
      onDataChange?.();
    } catch (e) {
      showToast(`Failed to save: ${(e as Error).message}`, true);
    } finally {
      setSubmitting(false);
    }
  };

  const handleReview = async (action: "approve" | "reject" | "request_changes") => {
    if (!system) return;
    setSubmitting(true);
    try {
      if (action === "approve") {
        await api.updateSystem(system.id, techForm);
      }
      await api.completeReview(system.id, { action, comment: comment.trim() || undefined });
      showToast(
        action === "approve" ? "Sent to compliance review"
          : action === "reject" ? "System rejected" : "Changes requested"
      );
      onReviewComplete();
      onClose();
    } catch (e) {
      showToast(`Review failed: ${(e as Error).message}`, true);
    } finally {
      setSubmitting(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !system) return;
    setUploading(true);
    try {
      const doc = await api.uploadDocument(system.id, file, docType);
      setDocuments(prev => [doc, ...prev]);
      showToast(`Uploaded ${file.name}`);
    } catch (err) {
      showToast(`Upload failed: ${(err as Error).message}`, true);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleDownload = async (doc: SystemDocument) => {
    if (!system) return;
    try {
      const { download_url } = await api.getDocumentDownloadUrl(system.id, doc.id);
      window.open(download_url, "_blank");
    } catch (err) {
      showToast(`Download failed: ${(err as Error).message}`, true);
    }
  };

  const handleDeleteDoc = async (doc: SystemDocument) => {
    if (!system || !confirm(`Delete ${doc.original_filename}?`)) return;
    try {
      await api.deleteDocument(system.id, doc.id);
      setDocuments(prev => prev.filter(d => d.id !== doc.id));
      showToast("Document deleted");
    } catch (err) {
      showToast(`Delete failed: ${(err as Error).message}`, true);
    }
  };

  if (!system) return null;

  const tabStyle = (isActive: boolean): React.CSSProperties => ({
    padding: "12px 20px",
    fontSize: 14,
    fontWeight: 500,
    background: isActive ? "#fff" : "transparent",
    border: "none",
    borderBottom: isActive ? "2px solid #3b82f6" : "2px solid transparent",
    color: isActive ? "#3b82f6" : "#64748b",
    cursor: "pointer",
  });

  const checkboxRowStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "8px 0",
    borderBottom: "1px solid #f1f5f9",
  };

  return (
    <div style={modalOverlayStyle} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={{ ...modalStyle, maxWidth: 800 }}>
        <div style={modalHeaderStyle}>
          <div>
            <h2 style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>Technical Review</h2>
            <div style={{ fontSize: 13, color: "#64748b", marginTop: 4 }}>{system.name} · {system.id}</div>
          </div>
          <button onClick={onClose} style={closeButtonStyle}>×</button>
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", borderBottom: "1px solid #e2e8f0", background: "#f8fafc" }}>
          <button style={tabStyle(activeTab === "overview")} onClick={() => setActiveTab("overview")}>
            Overview
          </button>
          <button style={tabStyle(activeTab === "technical")} onClick={() => setActiveTab("technical")}>
            Technical Details
          </button>
        </div>

        <div style={{ flex: 1, overflow: "auto", padding: 24 }}>
          {activeTab === "overview" ? (
            <>
              <div style={{ marginBottom: 24 }}>
                <h3 style={sectionHeadingStyle}>System Information</h3>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                  <InfoRow label="Risk Tier" value={<TierBadge tier={system.tier} />} />
                  <InfoRow label="Classification Basis" value={system.basis || "—"} />
                  <InfoRow label="Organization" value={system.org_name || "—"} />
                  <InfoRow label="Submitted By" value={system.submitted_by || "—"} />
                </div>
              </div>

              {system.description && (
                <div style={{ marginBottom: 24 }}>
                  <h3 style={sectionHeadingStyle}>Description</h3>
                  <p style={{ fontSize: 14, color: "#0f172a", margin: 0 }}>{system.description}</p>
                </div>
              )}

              {system.intended_purpose && (
                <div style={{ marginBottom: 24 }}>
                  <h3 style={sectionHeadingStyle}>Intended Purpose</h3>
                  <p style={{ fontSize: 14, color: "#0f172a", margin: 0 }}>{system.intended_purpose}</p>
                </div>
              )}

              <div style={{ marginBottom: 24 }}>
                <h3 style={sectionHeadingStyle}>Activity History</h3>
                {loading ? <Spinner size="sm" /> : activity.length === 0 ? (
                  <p style={{ color: "#94a3b8", fontSize: 13, margin: 0 }}>No activity</p>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {activity.slice(0, 5).map((entry) => (
                      <div key={entry.id} style={{ padding: 12, background: "#f8fafc", borderRadius: 8, border: "1px solid #e2e8f0" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                          <span><strong>{entry.actor}</strong> {entry.action.replace(/_/g, " ")}</span>
                          <span style={{ color: "#94a3b8", fontSize: 11 }}><FormattedDate iso={entry.created_at} /></span>
                        </div>
                        {entry.comment && <p style={{ fontSize: 12, color: "#64748b", margin: "4px 0 0" }}>"{entry.comment}"</p>}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <h3 style={sectionHeadingStyle}>Review Comment</h3>
                <textarea
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="Add notes for compliance review (optional)..."
                  style={{ width: "100%", minHeight: 80, padding: 12, border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 14, resize: "vertical", outline: "none" }}
                />
              </div>
            </>
          ) : (
            <>
              {/* Technical Details Tab - Mode Chooser or Content */}
              {techMode === "choose" ? (
                <div style={{ padding: 20 }}>
                  <div style={{ textAlign: "center", marginBottom: 32 }}>
                    <h3 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>How would you like to complete the technical review?</h3>
                    <p style={{ color: "#64748b", fontSize: 14 }}>Choose the approach that works best for you</p>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: fieldSuggestions.length > 0 || fieldConflicts.length > 0 ? "1fr 1fr 1fr" : "1fr 1fr", gap: 20, maxWidth: fieldSuggestions.length > 0 || fieldConflicts.length > 0 ? 900 : 600, margin: "0 auto" }}>
                    {/* Show suggestions option if we have suggestions or conflicts */}
                    {(fieldSuggestions.length > 0 || fieldConflicts.length > 0) && (
                      <button
                        onClick={() => setTechMode("suggestions")}
                        style={{
                          display: "flex", flexDirection: "column", alignItems: "center", padding: 24,
                          background: "linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%)",
                          border: "2px solid #22c55e", borderRadius: 12, cursor: "pointer",
                        }}
                      >
                        <div style={{ width: 56, height: 56, borderRadius: "50%", background: "#22c55e", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 16 }}>
                          <span style={{ fontSize: 24, color: "#fff" }}>📄</span>
                        </div>
                        <span style={{ fontSize: 16, fontWeight: 600, color: "#166534", marginBottom: 8 }}>Use Document Data</span>
                        <span style={{ fontSize: 13, color: "#16a34a", textAlign: "center", lineHeight: 1.5 }}>
                          {fieldSuggestions.length} field(s) found from uploaded documents
                          {fieldConflicts.length > 0 && ` (${fieldConflicts.length} need clarification)`}
                        </span>
                        <span style={{
                          marginTop: 12,
                          fontSize: 11,
                          fontWeight: 600,
                          color: "#fff",
                          background: "#22c55e",
                          padding: "4px 12px",
                          borderRadius: 4,
                        }}>RECOMMENDED</span>
                      </button>
                    )}

                    <button
                      onClick={startAiTechMode}
                      style={{
                        display: "flex", flexDirection: "column", alignItems: "center", padding: 24,
                        background: fieldSuggestions.length > 0 || fieldConflicts.length > 0 ? "#fff" : "linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%)",
                        border: fieldSuggestions.length > 0 || fieldConflicts.length > 0 ? "1px solid #e2e8f0" : "2px solid #3b82f6", borderRadius: 12, cursor: "pointer",
                      }}
                    >
                      <div style={{ width: 56, height: 56, borderRadius: "50%", background: "#3b82f6", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 16 }}>
                        <span style={{ fontSize: 24, color: "#fff" }}>✦</span>
                      </div>
                      <span style={{ fontSize: 16, fontWeight: 600, color: fieldSuggestions.length > 0 || fieldConflicts.length > 0 ? "#0f172a" : "#1e40af", marginBottom: 8 }}>AI-Assisted</span>
                      <span style={{ fontSize: 13, color: fieldSuggestions.length > 0 || fieldConflicts.length > 0 ? "#64748b" : "#3b82f6", textAlign: "center", lineHeight: 1.5 }}>
                        Answer guided questions about technical capabilities
                      </span>
                      {!(fieldSuggestions.length > 0 || fieldConflicts.length > 0) && (
                        <span style={{
                          marginTop: 12,
                          fontSize: 11,
                          fontWeight: 600,
                          color: "#3b82f6",
                          background: "#dbeafe",
                          padding: "4px 12px",
                          borderRadius: 4,
                        }}>RECOMMENDED</span>
                      )}
                    </button>

                    <button
                      onClick={() => setTechMode("manual")}
                      style={{
                        display: "flex", flexDirection: "column", alignItems: "center", padding: 24,
                        background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, cursor: "pointer",
                      }}
                    >
                      <div style={{ width: 56, height: 56, borderRadius: "50%", background: "#f1f5f9", border: "1px solid #e2e8f0", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 16 }}>
                        <span style={{ fontSize: 24, color: "#64748b" }}>📋</span>
                      </div>
                      <span style={{ fontSize: 16, fontWeight: 600, color: "#0f172a", marginBottom: 8 }}>Manual Form</span>
                      <span style={{ fontSize: 13, color: "#64748b", textAlign: "center", lineHeight: 1.5 }}>
                        Fill out classification checkboxes directly
                      </span>
                    </button>
                  </div>
                </div>
              ) : techMode === "suggestions" ? (
                /* Suggestions Mode - Review pre-filled values from documents */
                <SuggestionsReview
                  suggestions={fieldSuggestions}
                  conflicts={fieldConflicts}
                  summaryMessage={suggestionsSummary}
                  confirmedFields={confirmedFields}
                  resolvedConflicts={resolvedConflicts}
                  techForm={techForm}
                  onConfirm={(field) => {
                    setConfirmedFields(prev => new Set([...prev, field]));
                    // Apply the suggestion to techForm
                    const suggestion = fieldSuggestions.find(s => s.field === field);
                    if (suggestion) {
                      setTechForm(prev => ({ ...prev, [field]: suggestion.value }));
                    }
                  }}
                  onReject={(field) => {
                    // Remove from suggestions and let user edit manually
                    setFieldSuggestions(prev => prev.filter(s => s.field !== field));
                  }}
                  onResolveConflict={(field, value) => {
                    setResolvedConflicts(prev => ({ ...prev, [field]: value }));
                    setTechForm(prev => ({ ...prev, [field]: value }));
                    // Move from conflicts to confirmed
                    setFieldConflicts(prev => prev.filter(c => c.field !== field));
                    setConfirmedFields(prev => new Set([...prev, field]));
                  }}
                  onConfirmAll={() => {
                    const newConfirmed = new Set(confirmedFields);
                    const updates: Partial<TechReviewForm> = {};
                    fieldSuggestions.forEach(s => {
                      newConfirmed.add(s.field);
                      updates[s.field as keyof TechReviewForm] = s.value as TechReviewForm[keyof TechReviewForm];
                    });
                    setConfirmedFields(newConfirmed);
                    setTechForm(prev => ({ ...prev, ...updates }));
                  }}
                  onSwitchToManual={() => setTechMode("manual")}
                />
              ) : techMode === "ai" ? (
                /* AI-Assisted Technical Review - Using ChatFlowUI */
                <div style={{ overflow: "hidden" }}>
                  <ChatFlowUI
                    messages={chatFlow.messages}
                    isThinking={chatFlow.isThinking || isUploadingDoc}
                    chatEndRef={chatFlow.chatEndRef}
                    inputRef={chatFlow.inputRef}
                    onSubmit={chatFlow.submitInput}
                    form={chatFlow.form}
                    onFieldChange={chatFlow.updateField}
                    progress={chatFlow.progress}
                    progressLabel="Technical Details"
                    fields={TECH_FIELD_CONFIGS}
                    disclaimer="Information is generated with AI assistance. Please verify before saving."
                    onDocumentUpload={handleTechDocumentUpload}
                    isUploadingDocument={isUploadingDoc}
                    uploadedDocuments={uploadedDocs}
                  />
                </div>
              ) : (
                /* Manual Form Mode */
                <>
                  <div style={{ display: "flex", gap: 12, marginBottom: 20 }}>
                    <button
                      onClick={() => setTechMode("choose")}
                      style={{ padding: "8px 14px", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 6, fontSize: 13, cursor: "pointer" }}
                    >
                      ← Back
                    </button>
                    <div className="msg-strip info" style={{ flex: 1, margin: 0, padding: 12, background: "#eff6ff", borderRadius: 8, border: "1px solid #bfdbfe", fontSize: 13, color: "#1e40af" }}>
                      Please review and complete the technical details below. These are used for EU AI Act classification.
                    </div>
                    <button
                      onClick={handleAiAssist}
                      disabled={aiAssisting}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        padding: "10px 16px",
                        background: "linear-gradient(135deg, #8b5cf6 0%, #6366f1 100%)",
                        color: "#fff",
                        border: "none",
                        borderRadius: 8,
                        fontSize: 14,
                        fontWeight: 500,
                        cursor: aiAssisting ? "wait" : "pointer",
                        whiteSpace: "nowrap",
                        opacity: aiAssisting ? 0.7 : 1,
                      }}
                    >
                      {aiAssisting ? (
                        <>
                          <Spinner size="sm" color="white" />
                          Analyzing...
                        </>
                      ) : (
                        <>
                          <span style={{ fontSize: 16 }}>✨</span>
                          AI Assist
                        </>
                      )}
                    </button>
                  </div>

              <div style={{ marginBottom: 24 }}>
                <h3 style={sectionHeadingStyle}>Basic Technical Info</h3>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                  <div>
                    <label style={{ fontSize: 12, color: "#64748b", display: "block", marginBottom: 4 }}>Provider</label>
                    <input
                      type="text"
                      value={techForm.provider}
                      onChange={(e) => setTechForm(f => ({ ...f, provider: e.target.value }))}
                      placeholder="e.g., OpenAI, Anthropic, Internal"
                      style={{ width: "100%", padding: 10, border: "1px solid #e2e8f0", borderRadius: 6, fontSize: 14 }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: 12, color: "#64748b", display: "block", marginBottom: 4 }}>Version</label>
                    <input
                      type="text"
                      value={techForm.version}
                      onChange={(e) => setTechForm(f => ({ ...f, version: e.target.value }))}
                      placeholder="e.g., 1.0.0"
                      style={{ width: "100%", padding: 10, border: "1px solid #e2e8f0", borderRadius: 6, fontSize: 14 }}
                    />
                  </div>
                  <div style={{ gridColumn: "1 / -1" }}>
                    <label style={{ fontSize: 12, color: "#64748b", display: "block", marginBottom: 4 }}>Application URL</label>
                    <input
                      type="text"
                      value={techForm.application_url}
                      onChange={(e) => setTechForm(f => ({ ...f, application_url: e.target.value }))}
                      placeholder="https://..."
                      style={{ width: "100%", padding: 10, border: "1px solid #e2e8f0", borderRadius: 6, fontSize: 14 }}
                    />
                  </div>
                </div>
              </div>

              <div style={{ marginBottom: 24 }}>
                <h3 style={sectionHeadingStyle}>GPAI Classification</h3>
                <div style={checkboxRowStyle}>
                  <input
                    type="checkbox"
                    id="is_gpai"
                    checked={techForm.is_gpai}
                    onChange={(e) => setTechForm(f => ({ ...f, is_gpai: e.target.checked }))}
                  />
                  <label htmlFor="is_gpai" style={{ fontSize: 14, cursor: "pointer", flex: 1 }}>
                    This is a General Purpose AI (GPAI) system
                  </label>
                  {aiSuggestions?.is_gpai && (
                    <AiSuggestion
                      suggestion={aiSuggestions.is_gpai}
                      currentValue={techForm.is_gpai}
                      onApply={() => setTechForm(f => ({ ...f, is_gpai: aiSuggestions.is_gpai!.value }))}
                    />
                  )}
                </div>
                {techForm.is_gpai && (
                  <div style={{ marginTop: 12, marginLeft: 24 }}>
                    <label style={{ fontSize: 12, color: "#64748b", display: "block", marginBottom: 4 }}>
                      Training Compute (FLOPs)
                    </label>
                    <input
                      type="number"
                      value={techForm.training_compute_flops}
                      onChange={(e) => setTechForm(f => ({ ...f, training_compute_flops: parseFloat(e.target.value) || 0 }))}
                      placeholder="e.g., 1e25"
                      style={{ width: 200, padding: 10, border: "1px solid #e2e8f0", borderRadius: 6, fontSize: 14 }}
                    />
                    <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 4 }}>
                      ≥10²⁵ FLOPs = Systemic Risk GPAI
                    </div>
                  </div>
                )}
              </div>

              <div style={{ marginBottom: 24 }}>
                <h3 style={sectionHeadingStyle}>Transparency Requirements (Art. 50)</h3>
                <div style={checkboxRowStyle}>
                  <input
                    type="checkbox"
                    id="is_chatbot"
                    checked={techForm.is_chatbot}
                    onChange={(e) => setTechForm(f => ({ ...f, is_chatbot: e.target.checked }))}
                  />
                  <label htmlFor="is_chatbot" style={{ fontSize: 14, cursor: "pointer", flex: 1 }}>
                    System interacts directly with users (chatbot)
                  </label>
                  {aiSuggestions?.is_chatbot && (
                    <AiSuggestion
                      suggestion={aiSuggestions.is_chatbot}
                      currentValue={techForm.is_chatbot}
                      onApply={() => setTechForm(f => ({ ...f, is_chatbot: aiSuggestions.is_chatbot!.value }))}
                    />
                  )}
                </div>
                <div style={checkboxRowStyle}>
                  <input
                    type="checkbox"
                    id="generates_synthetic"
                    checked={techForm.generates_synthetic_content}
                    onChange={(e) => setTechForm(f => ({ ...f, generates_synthetic_content: e.target.checked }))}
                  />
                  <label htmlFor="generates_synthetic" style={{ fontSize: 14, cursor: "pointer", flex: 1 }}>
                    Generates synthetic audio, image, video, or text
                  </label>
                  {aiSuggestions?.generates_synthetic_content && (
                    <AiSuggestion
                      suggestion={aiSuggestions.generates_synthetic_content}
                      currentValue={techForm.generates_synthetic_content}
                      onApply={() => setTechForm(f => ({ ...f, generates_synthetic_content: aiSuggestions.generates_synthetic_content!.value }))}
                    />
                  )}
                </div>
              </div>

              <div style={{ marginBottom: 24 }}>
                <h3 style={sectionHeadingStyle}>High-Risk Classification (Annex III)</h3>
                <div style={checkboxRowStyle}>
                  <input
                    type="checkbox"
                    id="is_biometric"
                    checked={techForm.is_biometric_identification}
                    onChange={(e) => setTechForm(f => ({ ...f, is_biometric_identification: e.target.checked }))}
                  />
                  <label htmlFor="is_biometric" style={{ fontSize: 14, cursor: "pointer", flex: 1 }}>
                    Biometric identification or categorization
                  </label>
                  {aiSuggestions?.is_biometric_identification && (
                    <AiSuggestion
                      suggestion={aiSuggestions.is_biometric_identification}
                      currentValue={techForm.is_biometric_identification}
                      onApply={() => setTechForm(f => ({ ...f, is_biometric_identification: aiSuggestions.is_biometric_identification!.value }))}
                    />
                  )}
                </div>
                <div style={checkboxRowStyle}>
                  <input
                    type="checkbox"
                    id="is_critical"
                    checked={techForm.is_critical_infrastructure}
                    onChange={(e) => setTechForm(f => ({ ...f, is_critical_infrastructure: e.target.checked }))}
                  />
                  <label htmlFor="is_critical" style={{ fontSize: 14, cursor: "pointer", flex: 1 }}>
                    Critical infrastructure management
                  </label>
                  {aiSuggestions?.is_critical_infrastructure && (
                    <AiSuggestion
                      suggestion={aiSuggestions.is_critical_infrastructure}
                      currentValue={techForm.is_critical_infrastructure}
                      onApply={() => setTechForm(f => ({ ...f, is_critical_infrastructure: aiSuggestions.is_critical_infrastructure!.value }))}
                    />
                  )}
                </div>
              </div>

              <div style={{ marginBottom: 24 }}>
                <h3 style={sectionHeadingStyle}>Prohibited Practices (Art. 5)</h3>
                <div style={{ background: "#fef2f2", borderRadius: 8, padding: 12, marginBottom: 12 }}>
                  <span style={{ fontSize: 12, color: "#dc2626" }}>⚠ Check only if applicable — these result in prohibited classification</span>
                </div>
                <div style={checkboxRowStyle}>
                  <input
                    type="checkbox"
                    id="subliminal"
                    checked={techForm.subliminal_manipulation}
                    onChange={(e) => setTechForm(f => ({ ...f, subliminal_manipulation: e.target.checked }))}
                  />
                  <label htmlFor="subliminal" style={{ fontSize: 14, cursor: "pointer" }}>
                    Subliminal manipulation techniques
                  </label>
                </div>
                <div style={checkboxRowStyle}>
                  <input
                    type="checkbox"
                    id="exploits"
                    checked={techForm.exploits_vulnerability}
                    onChange={(e) => setTechForm(f => ({ ...f, exploits_vulnerability: e.target.checked }))}
                  />
                  <label htmlFor="exploits" style={{ fontSize: 14, cursor: "pointer" }}>
                    Exploits vulnerabilities of specific groups
                  </label>
                </div>
                <div style={checkboxRowStyle}>
                  <input
                    type="checkbox"
                    id="social_scoring"
                    checked={techForm.social_scoring_public}
                    onChange={(e) => setTechForm(f => ({ ...f, social_scoring_public: e.target.checked }))}
                  />
                  <label htmlFor="social_scoring" style={{ fontSize: 14, cursor: "pointer" }}>
                    Social scoring by public authorities
                  </label>
                </div>
                <div style={checkboxRowStyle}>
                  <input
                    type="checkbox"
                    id="realtime_biometric"
                    checked={techForm.real_time_biometric_public}
                    onChange={(e) => setTechForm(f => ({ ...f, real_time_biometric_public: e.target.checked }))}
                  />
                  <label htmlFor="realtime_biometric" style={{ fontSize: 14, cursor: "pointer" }}>
                    Real-time biometric identification in public spaces
                  </label>
                </div>
              </div>

              {/* Documentation Upload Section */}
              <div style={{ marginBottom: 24 }}>
                <h3 style={sectionHeadingStyle}>Technical Documentation</h3>
                <div style={{ background: "#f8fafc", borderRadius: 8, padding: 16, border: "1px dashed #cbd5e1" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
                    <select
                      value={docType}
                      onChange={(e) => setDocType(e.target.value)}
                      style={{ padding: "8px 12px", border: "1px solid #e2e8f0", borderRadius: 6, fontSize: 13 }}
                    >
                      <option value="technical_spec">Technical Specification</option>
                      <option value="model_card">Model Card</option>
                      <option value="risk_assessment">Risk Assessment</option>
                      <option value="other">Other Documentation</option>
                    </select>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".pdf,.doc,.docx,.txt,.md,.json"
                      onChange={handleFileUpload}
                      style={{ display: "none" }}
                    />
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      disabled={uploading}
                      style={{
                        padding: "8px 16px",
                        background: "#3b82f6",
                        color: "#fff",
                        border: "none",
                        borderRadius: 6,
                        fontSize: 13,
                        fontWeight: 500,
                        cursor: uploading ? "wait" : "pointer",
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                      }}
                    >
                      {uploading ? <Spinner size="sm" color="white" /> : "📄"} Upload Document
                    </button>
                  </div>
                  <div style={{ fontSize: 11, color: "#64748b" }}>
                    Supported: PDF, Word, TXT, Markdown, JSON (max 10MB)
                  </div>
                </div>

                {/* Document List */}
                {documents.length > 0 && (
                  <div style={{ marginTop: 12 }}>
                    {documents.map((doc) => (
                      <div
                        key={doc.id}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          padding: "10px 12px",
                          background: "#fff",
                          border: "1px solid #e2e8f0",
                          borderRadius: 6,
                          marginBottom: 8,
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <span style={{ fontSize: 18 }}>
                            {doc.content_type.includes("pdf") ? "📕" : doc.content_type.includes("word") ? "📘" : "📄"}
                          </span>
                          <div>
                            <div style={{ fontSize: 13, fontWeight: 500, color: "#0f172a" }}>{doc.original_filename}</div>
                            <div style={{ fontSize: 11, color: "#64748b" }}>
                              {doc.doc_type.replace("_", " ")} • {Math.round(doc.size_bytes / 1024)}KB • {doc.uploaded_by}
                            </div>
                          </div>
                        </div>
                        <div style={{ display: "flex", gap: 8 }}>
                          <button
                            onClick={() => handleDownload(doc)}
                            style={{ padding: "4px 10px", background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 4, color: "#2563eb", fontSize: 12, cursor: "pointer" }}
                          >
                            Download
                          </button>
                          <button
                            onClick={() => handleDeleteDoc(doc)}
                            style={{ padding: "4px 10px", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 4, color: "#dc2626", fontSize: 12, cursor: "pointer" }}
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: 12 }}>
                <button onClick={handleSaveTechnical} disabled={submitting} style={successButtonStyle}>
                  {submitting ? "Saving..." : techSaved ? "✓ Saved — Update" : "Save & Continue"}
                </button>
              </div>
                </>
              )}
            </>
          )}
        </div>

        <div style={modalFooterStyle}>
          {/* Left side: Cancel + More dropdown */}
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <button onClick={onClose} disabled={submitting} style={secondaryButtonStyle}>Cancel</button>
            <MoreDropdown
              onReject={() => handleReview("reject")}
              onViewHistory={() => setActiveTab("overview")}
            />
          </div>

          {/* Right side: Action buttons */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: "auto" }}>
            <button onClick={() => handleReview("request_changes")} disabled={submitting} style={outlineButtonStyle}>
              Request changes
            </button>
            <button onClick={handleSaveTechnical} disabled={submitting} style={outlineButtonStyle}>
              {submitting ? "Saving..." : "Save draft"}
            </button>
            <button onClick={() => handleReview("approve")} disabled={submitting} style={primaryButtonStyle}>
              {submitting ? "..." : "Forward to Compliance"} <span style={{ marginLeft: 4 }}>›</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <span style={{ fontSize: 11, color: "#94a3b8", textTransform: "uppercase" }}>{label}</span>
      <div style={{ fontSize: 14, color: "#0f172a", marginTop: 4 }}>{value}</div>
    </div>
  );
}

// Editable text field for AI chat mode
function TechFieldDisplay({ label, value, onEdit }: { label: string; value: string; onEdit: (v: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(value);

  const handleSave = () => {
    onEdit(editValue);
    setEditing(false);
  };

  if (editing) {
    return (
      <div style={{ padding: "8px 0", borderBottom: "1px solid #e2e8f0" }}>
        <div style={{ fontSize: 11, color: "#64748b", marginBottom: 4 }}>{label}</div>
        <div style={{ display: "flex", gap: 6 }}>
          <input
            type="text"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            style={{ flex: 1, padding: "6px 10px", border: "1px solid #3b82f6", borderRadius: 4, fontSize: 13, outline: "none" }}
            autoFocus
            onKeyDown={(e) => { if (e.key === "Enter") handleSave(); if (e.key === "Escape") setEditing(false); }}
          />
          <button onClick={handleSave} style={{ padding: "6px 10px", background: "#3b82f6", color: "#fff", border: "none", borderRadius: 4, fontSize: 11, cursor: "pointer" }}>Save</button>
          <button onClick={() => setEditing(false)} style={{ padding: "6px 10px", background: "#f1f5f9", color: "#64748b", border: "none", borderRadius: 4, fontSize: 11, cursor: "pointer" }}>Cancel</button>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 0", borderBottom: "1px solid #e2e8f0", cursor: "pointer" }}
      onClick={() => { setEditValue(value); setEditing(true); }}
    >
      <span style={{
        width: 16, height: 16, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
        background: value ? "#f0fdf4" : "#f1f5f9", color: value ? "#16a34a" : "#94a3b8", fontSize: 10, flexShrink: 0,
      }}>
        {value ? "✓" : "?"}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 10, color: "#94a3b8" }}>{label}</div>
        <div style={{ fontSize: 13, color: value ? "#0f172a" : "#94a3b8", fontStyle: value ? "normal" : "italic", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {value || "Not provided"}
        </div>
      </div>
      <span style={{ color: "#94a3b8", fontSize: 10 }}>✎</span>
    </div>
  );
}

// Checkbox display for AI chat mode
function TechCheckDisplay({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div
      style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", cursor: "pointer" }}
      onClick={() => onChange(!checked)}
    >
      <span style={{
        width: 16, height: 16, borderRadius: 4, display: "flex", alignItems: "center", justifyContent: "center",
        background: checked ? "#3b82f6" : "#fff", border: checked ? "none" : "1px solid #cbd5e1", color: "#fff", fontSize: 10,
      }}>
        {checked && "✓"}
      </span>
      <span style={{ fontSize: 12, color: "#475569" }}>{label}</span>
    </div>
  );
}

// Styles
const modalOverlayStyle: React.CSSProperties = { position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 };
const modalStyle: React.CSSProperties = { background: "#fff", borderRadius: 12, width: "90%", maxWidth: 800, maxHeight: "90vh", display: "flex", flexDirection: "column", boxShadow: "0 20px 40px rgba(0,0,0,0.15)" };
const modalHeaderStyle: React.CSSProperties = { padding: 24, borderBottom: "1px solid #e2e8f0", display: "flex", justifyContent: "space-between", alignItems: "flex-start" };
const modalFooterStyle: React.CSSProperties = { padding: 20, borderTop: "1px solid #e2e8f0", display: "flex", gap: 8, justifyContent: "flex-end" };
const closeButtonStyle: React.CSSProperties = { width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", background: "none", border: "none", fontSize: 24, color: "#94a3b8", cursor: "pointer", borderRadius: 6 };
const sectionHeadingStyle: React.CSSProperties = { fontSize: 12, fontWeight: 600, marginBottom: 12, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.05em" };
const secondaryButtonStyle: React.CSSProperties = { padding: "10px 16px", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, color: "#475569", fontSize: 14, fontWeight: 500, cursor: "pointer" };
const dangerButtonStyle: React.CSSProperties = { padding: "10px 16px", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, color: "#dc2626", fontSize: 14, fontWeight: 500, cursor: "pointer" };
const warningButtonStyle: React.CSSProperties = { padding: "10px 16px", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 8, color: "#d97706", fontSize: 14, fontWeight: 500, cursor: "pointer" };
const successButtonStyle: React.CSSProperties = { padding: "10px 16px", background: "#22c55e", border: "none", borderRadius: 8, color: "#fff", fontSize: 14, fontWeight: 500, cursor: "pointer" };

// AI Suggestion styles
const suggestionBadgeStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "6px 12px",
  background: "linear-gradient(135deg, #f5f3ff 0%, #ede9fe 100%)",
  borderRadius: 8,
  border: "1px solid #c4b5fd",
  marginLeft: "auto",
  flexShrink: 0,
};
const suggestionMatchStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "6px 12px",
  background: "#ecfdf5",
  borderRadius: 8,
  border: "1px solid #a7f3d0",
  marginLeft: "auto",
  flexShrink: 0,
};
const applySuggestionButtonStyle: React.CSSProperties = {
  padding: "4px 10px",
  background: "#8b5cf6",
  color: "#fff",
  border: "none",
  borderRadius: 4,
  fontSize: 12,
  fontWeight: 500,
  cursor: "pointer",
  marginLeft: 8,
};

// More dropdown component
function MoreDropdown({ onReject, onViewHistory }: { onReject: () => void; onViewHistory: () => void }) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div style={{ position: "relative" }}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "10px 16px",
          background: "#fff",
          border: "1px solid #e2e8f0",
          borderRadius: 8,
          color: "#475569",
          fontSize: 14,
          fontWeight: 500,
          cursor: "pointer",
        }}
      >
        More <span style={{ fontSize: 10 }}>{isOpen ? "▲" : "▼"}</span>
      </button>
      {isOpen && (
        <>
          <div
            style={{ position: "fixed", inset: 0, zIndex: 10 }}
            onClick={() => setIsOpen(false)}
          />
          <div style={{
            position: "absolute",
            bottom: "100%",
            left: 0,
            marginBottom: 4,
            background: "#fff",
            border: "1px solid #e2e8f0",
            borderRadius: 8,
            boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
            minWidth: 180,
            zIndex: 20,
            overflow: "hidden",
          }}>
            <button
              onClick={() => { setIsOpen(false); onReject(); }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                width: "100%",
                padding: "12px 16px",
                background: "transparent",
                border: "none",
                color: "#dc2626",
                fontSize: 14,
                cursor: "pointer",
                textAlign: "left",
              }}
              onMouseEnter={(e) => e.currentTarget.style.background = "#fef2f2"}
              onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
            >
              <span>✕</span> Reject review
            </button>
            <button
              onClick={() => { setIsOpen(false); onViewHistory(); }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                width: "100%",
                padding: "12px 16px",
                background: "transparent",
                border: "none",
                color: "#475569",
                fontSize: 14,
                cursor: "pointer",
                textAlign: "left",
              }}
              onMouseEnter={(e) => e.currentTarget.style.background = "#f8fafc"}
              onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
            >
              <span>🕐</span> View audit history
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// New button styles for the updated footer
const outlineButtonStyle: React.CSSProperties = {
  padding: "10px 16px",
  background: "#fff",
  border: "1px solid #e2e8f0",
  borderRadius: 8,
  color: "#475569",
  fontSize: 14,
  fontWeight: 500,
  cursor: "pointer",
};

const primaryButtonStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  padding: "10px 20px",
  background: "#3b82f6",
  border: "none",
  borderRadius: 8,
  color: "#fff",
  fontSize: 14,
  fontWeight: 500,
  cursor: "pointer",
};
