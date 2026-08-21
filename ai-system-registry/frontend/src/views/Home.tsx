import { useState, useEffect, useCallback } from "react";
import { Button, Chip, Spinner, Avatar } from "@heroui/react";
import { useNavigate } from "react-router-dom";
import { TierBadge, FormattedDate } from "../components/Badges";
import { api } from "../api/client";
import { useToast, useModalControls } from "../App";
import type { AISystem, RegistrationStatus } from "../types";

// SVG Icons
const WandIcon = () => (
  <svg width="64" height="64" viewBox="0 0 64 64" fill="none">
    <rect width="64" height="64" rx="16" fill="#eff6ff"/>
    <path d="M20 44l24-24M30 20l3 3-3 3-3-3 3-3zM44 34l-3 3 3 3 3-3-3-3z" stroke="#3b82f6" strokeWidth="2.5" strokeLinecap="round"/>
    <path d="M22 22l3 3M39 39l3 3M22 39l3-3M39 22l3-3" stroke="#3b82f6" strokeWidth="2" strokeLinecap="round"/>
  </svg>
);

const SparkleIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
    <path d="M8 0l1 5h5l-4 3 2 5-4-3-4 3 2-5-4-3h5l1-5z"/>
  </svg>
);

const ClipboardIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
    <path d="M10 1H6a1 1 0 00-1 1v1H3a1 1 0 00-1 1v10a1 1 0 001 1h10a1 1 0 001-1V4a1 1 0 00-1-1h-2V2a1 1 0 00-1-1zM6 2h4v2H6V2z"/>
  </svg>
);

const CheckCircleIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
    <circle cx="8" cy="8" r="6"/>
    <path d="M5.5 8l2 2 3-4" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

const ClockIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
    <circle cx="8" cy="8" r="6"/>
    <path d="M8 4v4l3 2" strokeLinecap="round"/>
  </svg>
);

const AlertIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
    <circle cx="8" cy="8" r="6"/>
    <path d="M8 5v4M8 11v.01" strokeLinecap="round"/>
  </svg>
);

const ArrowRightIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
    <path d="M3 8h10M9 4l4 4-4 4" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

const DocumentIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
    <path d="M5 5a2 2 0 012-2h8l4 4v12a2 2 0 01-2 2H7a2 2 0 01-2-2V5z" strokeLinecap="round"/>
    <path d="M15 3v4h4M9 11h6M9 15h6M9 19h4" strokeLinecap="round"/>
  </svg>
);

const MailIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
    <rect x="2" y="3" width="12" height="10" rx="1"/>
    <path d="M2 4l6 5 6-5" strokeLinecap="round"/>
  </svg>
);

const TotalIcon = () => (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
    <rect x="2" y="2" width="16" height="16" rx="3" fill="#eff6ff"/>
    <rect x="5" y="5" width="4" height="4" rx="1" fill="#3b82f6"/>
    <rect x="11" y="5" width="4" height="4" rx="1" fill="#3b82f6"/>
    <rect x="5" y="11" width="4" height="4" rx="1" fill="#3b82f6"/>
    <rect x="11" y="11" width="4" height="4" rx="1" fill="#3b82f6"/>
  </svg>
);

const ProgressIcon = () => (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
    <circle cx="10" cy="10" r="8" fill="#fef3c7"/>
    <path d="M10 4a6 6 0 016 6" stroke="#f59e0b" strokeWidth="2" strokeLinecap="round"/>
  </svg>
);

const ActiveIcon = () => (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
    <circle cx="10" cy="10" r="8" fill="#dcfce7"/>
    <path d="M7 10l2 2 4-4" stroke="#22c55e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

const RiskIcon = () => (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
    <circle cx="10" cy="10" r="8" fill="#fee2e2"/>
    <path d="M10 6v5M10 13v.01" stroke="#ef4444" strokeWidth="2" strokeLinecap="round"/>
  </svg>
);

const MoreIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
    <circle cx="3" cy="8" r="1.5"/>
    <circle cx="8" cy="8" r="1.5"/>
    <circle cx="13" cy="8" r="1.5"/>
  </svg>
);

const ChevronUpIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M4 10l4-4 4 4" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

// Status config
const STATUS_CONFIG: Record<RegistrationStatus, { color: "default" | "primary" | "warning" | "success" | "danger"; label: string }> = {
  draft: { color: "default", label: "Draft" },
  pending_technical_review: { color: "warning", label: "Technical review" },
  pending_compliance_review: { color: "primary", label: "Compliance review" },
  approved: { color: "success", label: "Active" },
  rejected: { color: "danger", label: "Rejected" },
};

function StatusBadge({ status }: { status: RegistrationStatus }) {
  const config = STATUS_CONFIG[status] || STATUS_CONFIG.draft;
  return <Chip size="sm" variant="flat" color={config.color}>{config.label}</Chip>;
}

// Workflow step component
function WorkflowSteps({ status }: { status: RegistrationStatus }) {
  const steps = [
    { key: "submitted", label: "Submitted" },
    { key: "technical", label: "Technical review" },
    { key: "compliance", label: "Compliance review" },
    { key: "active", label: "Active" },
  ];

  const currentStep = status === "approved" ? 4 :
    status === "pending_compliance_review" ? 3 :
    status === "pending_technical_review" ? 2 :
    status === "draft" ? 0 : 1;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
      {steps.map((step, idx) => {
        const isComplete = idx < currentStep;
        const isCurrent = idx === currentStep;

        return (
          <div key={step.key} style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <div
              style={{
                width: 24,
                height: 24,
                borderRadius: "50%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: isComplete ? "#3b82f6" : isCurrent ? "#dbeafe" : "#f1f5f9",
                border: isCurrent ? "2px solid #3b82f6" : "none",
              }}
            >
              {isComplete ? (
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="white" strokeWidth="2">
                  <path d="M2 6l3 3 5-5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              ) : null}
            </div>
            {idx < steps.length - 1 && (
              <div
                style={{
                  width: 16,
                  height: 2,
                  background: idx < currentStep ? "#3b82f6" : "#e2e8f0",
                  borderRadius: 1,
                }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function Home() {
  const [systems, setSystems] = useState<AISystem[]>([]);
  const [loading, setLoading] = useState(true);
  const [sectionsExpanded, setSectionsExpanded] = useState({ register: true, actions: true, systems: true });
  const { setWizardOpen, mayWrite, refreshKey } = useModalControls();
  const showToast = useToast();
  const navigate = useNavigate();

  const loadSystems = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.getSystems();
      setSystems(data);
    } catch (err) {
      showToast(`Failed to load systems: ${(err as Error).message}`, true);
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    loadSystems();
  }, [loadSystems, refreshKey]);

  // Categorize systems
  const total = systems.length;
  const inProgress = systems.filter((s) =>
    s.registration_status === "pending_technical_review" ||
    s.registration_status === "pending_compliance_review" ||
    (s.registration_status || "draft") === "draft"
  ).length;
  const active = systems.filter((s) => s.registration_status === "approved").length;
  const atRisk = systems.filter((s) => s.tier === "high" || s.tier === "prohibited").length;

  // Action items
  const actionItems = systems.filter((s) =>
    s.registration_status === "pending_technical_review" ||
    s.registration_status === "pending_compliance_review"
  ).slice(0, 3);

  // Recent activity (mock data based on systems)
  const recentActivity = systems.slice(0, 4).map((sys, idx) => ({
    label: idx === 0 ? "Technical review started" : idx === 1 ? "Model confirmation requested" : idx === 2 ? "Change detected" : "System activated",
    system: sys.name,
    time: idx === 0 ? "Today" : idx === 1 ? "Yesterday" : `Aug ${10 - idx}`,
    timeDetail: idx === 0 ? "10:24 AM" : idx === 1 ? "4:15 PM" : `${11 - idx}:32 AM`,
    color: idx === 0 ? "#3b82f6" : idx === 1 ? "#f59e0b" : idx === 2 ? "#8b5cf6" : "#22c55e",
  }));

  const toggleSection = (section: keyof typeof sectionsExpanded) => {
    setSectionsExpanded(prev => ({ ...prev, [section]: !prev[section] }));
  };

  return (
    <div style={{ display: "flex", gap: 24 }}>
      {/* Main Column */}
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 20 }}>
        {/* Section 1: Register New System */}
        <div style={cardStyle}>
          <div
            style={{ ...cardHeaderStyle, cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center" }}
            onClick={() => toggleSection("register")}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={sectionNumber}>1</span>
              <h3 style={{ ...sectionTitle, margin: 0 }}>Register a new AI system</h3>
            </div>
            <span style={{ transform: sectionsExpanded.register ? "rotate(0deg)" : "rotate(180deg)", transition: "transform 0.2s", color: "#94a3b8" }}>
              <ChevronUpIcon />
            </span>
          </div>
          {sectionsExpanded.register && (
            <div style={{ padding: "20px 24px", display: "flex", alignItems: "flex-start", gap: 24 }}>
              <WandIcon />
              <div style={{ flex: 1 }}>
                <p style={{ ...sectionDesc, marginBottom: 16 }}>
                  Let AI guide you through a few questions and capture what matters.
                </p>
                <div style={{ display: "flex", gap: 32 }}>
                  <FeatureItem icon={<SparkleIcon />} title="AI-powered guidance" desc="Answer only what's relevant." />
                  <FeatureItem icon={<ClipboardIcon />} title="Smart information capture" desc="We extract and pre-fill for you." />
                  <FeatureItem icon={<CheckCircleIcon />} title="Compliant by design" desc="Aligned with AI Act requirements." />
                </div>
              </div>
              <button
                onClick={() => setWizardOpen(true)}
                disabled={!mayWrite}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "12px 20px",
                  background: "#3b82f6",
                  border: "none",
                  borderRadius: 8,
                  color: "#fff",
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: mayWrite ? "pointer" : "not-allowed",
                  opacity: mayWrite ? 1 : 0.5,
                  flexShrink: 0,
                  transition: "background 0.15s",
                }}
              >
                + Register new AI system
              </button>
            </div>
          )}
        </div>

        {/* Section 2: Action Items */}
        <div style={cardStyle}>
          <div
            style={{ ...cardHeaderStyle, cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center" }}
            onClick={() => toggleSection("actions")}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={sectionNumber}>2</span>
              <h3 style={{ ...sectionTitle, margin: 0 }}>Your action items</h3>
            </div>
            <span style={{ transform: sectionsExpanded.actions ? "rotate(0deg)" : "rotate(180deg)", transition: "transform 0.2s", color: "#94a3b8" }}>
              <ChevronUpIcon />
            </span>
          </div>
          {sectionsExpanded.actions && (
            <div>
              {loading ? (
                <div style={{ display: "flex", justifyContent: "center", padding: 40 }}>
                  <Spinner />
                </div>
              ) : actionItems.length === 0 ? (
                <div style={{ textAlign: "center", padding: 40, color: "#64748b" }}>
                  <span style={{ color: "#22c55e" }}><CheckCircleIcon /></span>
                  <p style={{ marginTop: 8 }}>No pending action items</p>
                </div>
              ) : (
                <>
                  {actionItems.map((sys, idx) => (
                    <ActionItemRow key={sys.id} system={sys} isLast={idx === actionItems.length - 1} />
                  ))}
                  <div style={{ padding: "12px 24px", borderTop: "1px solid #f1f5f9" }}>
                    <Button variant="light" color="primary" size="sm" onPress={() => navigate("/systems")}>
                      View all action items <ArrowRightIcon />
                    </Button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* Section 3: Your AI Systems - Pipeline */}
        <div style={cardStyle}>
          <div
            style={{ ...cardHeaderStyle, cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center" }}
            onClick={() => toggleSection("systems")}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={sectionNumber}>3</span>
              <div>
                <h3 style={{ ...sectionTitle, margin: 0 }}>Your AI systems</h3>
                <p style={{ fontSize: 13, color: "#64748b", margin: "4px 0 0" }}>{total} total AI systems</p>
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              {atRisk > 0 && (
                <span style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "6px 12px",
                  background: "#fef2f2",
                  border: "1px solid #fecaca",
                  borderRadius: 20,
                  fontSize: 13,
                  fontWeight: 500,
                  color: "#dc2626",
                }}>
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M7 1l6 11H1L7 1z" strokeLinejoin="round"/>
                    <path d="M7 5v3M7 10v.01" strokeLinecap="round"/>
                  </svg>
                  Needs attention {atRisk}
                </span>
              )}
              <span style={{ transform: sectionsExpanded.systems ? "rotate(0deg)" : "rotate(180deg)", transition: "transform 0.2s", color: "#94a3b8" }}>
                <ChevronUpIcon />
              </span>
            </div>
          </div>
          {sectionsExpanded.systems && (
            <div style={{ padding: "24px 24px 28px" }}>
              {loading ? (
                <div style={{ display: "flex", justifyContent: "center", padding: 40 }}>
                  <Spinner />
                </div>
              ) : (
                <>
                  {/* Workflow Pipeline */}
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
                    <PipelineStep
                      label="Registered"
                      count={total}
                      color="#3b82f6"
                      bgColor="#eff6ff"
                      icon={<DocumentIcon />}
                    />
                    <PipelineStep
                      label="Technical review"
                      count={systems.filter(s => s.registration_status === "pending_technical_review").length}
                      color="#f59e0b"
                      bgColor="#fef3c7"
                      icon={<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M14.5 5.5L18 9l-3.5 3.5M5.5 5.5L2 9l3.5 3.5M12 3l-4 14" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                    />
                    <PipelineStep
                      label="Compliance review"
                      count={systems.filter(s => s.registration_status === "pending_compliance_review").length}
                      color="#8b5cf6"
                      bgColor="#f3e8ff"
                      icon={<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M12 2L4 6v6c0 5 4 8 8 10 4-2 8-5 8-10V6l-8-4z" strokeLinecap="round" strokeLinejoin="round"/><path d="M9 12l2 2 4-4" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                    />
                    <PipelineStep
                      label="Active / Deployed"
                      count={active}
                      color="#22c55e"
                      bgColor="#dcfce7"
                      icon={<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="12" r="9"/><path d="M9 12l2 2 4-4" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                      isLast
                    />
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Right Sidebar */}
      <div style={{ width: 300, flexShrink: 0, display: "flex", flexDirection: "column", gap: 20 }}>
        {/* Recent Activity */}
        <div style={cardStyle}>
          <div style={{ ...cardHeaderStyle, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h4 style={{ fontSize: 14, fontWeight: 600, color: "#0f172a", margin: 0 }}>Recent activity</h4>
            <Button variant="light" color="primary" size="sm">View all</Button>
          </div>
          <div style={{ padding: "8px 20px 16px" }}>
            {recentActivity.length === 0 ? (
              <p style={{ fontSize: 13, color: "#64748b", textAlign: "center", padding: 16 }}>No recent activity</p>
            ) : (
              recentActivity.map((item, idx) => (
                <ActivityItem key={idx} {...item} />
              ))
            )}
          </div>
        </div>

        {/* Help Card */}
        <div style={cardStyle}>
          <div style={{ padding: 20 }}>
            <h4 style={{ fontSize: 14, fontWeight: 600, color: "#0f172a", marginBottom: 8 }}>Need help?</h4>
            <p style={{ fontSize: 13, color: "#64748b", marginBottom: 16 }}>
              Ask AI for guidance or contact the AI Trust team.
            </p>
            <button
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                width: "100%",
                padding: "10px 16px",
                background: "#eff6ff",
                border: "1px solid #bfdbfe",
                borderRadius: 8,
                color: "#2563eb",
                fontSize: 14,
                fontWeight: 500,
                cursor: "pointer",
                marginBottom: 8,
                transition: "background 0.15s",
              }}
            >
              <SparkleIcon /> Ask AI Assistant
            </button>
            <button
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                width: "100%",
                padding: "10px 16px",
                background: "#f8fafc",
                border: "1px solid #e2e8f0",
                borderRadius: 8,
                color: "#475569",
                fontSize: 14,
                fontWeight: 500,
                cursor: "pointer",
                transition: "background 0.15s",
              }}
            >
              <MailIcon /> Contact AI Trust team
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Sub-components
function FeatureItem({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
      <span style={{ color: "#3b82f6", marginTop: 2 }}>{icon}</span>
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, color: "#0f172a" }}>{title}</div>
        <div style={{ fontSize: 12, color: "#64748b" }}>{desc}</div>
      </div>
    </div>
  );
}

function ActionItemRow({ system, isLast }: { system: AISystem; isLast: boolean }) {
  const isCompliance = system.registration_status === "pending_compliance_review";
  const progress = isCompliance ? 60 : 80;
  const dueText = isCompliance ? "Due in 6 days" : "Due today";

  // Use actual assignee from system.waiting_on
  const assignee = system.waiting_on || "Pending";
  const assigneeInitials = assignee === "Pending" ? "?" : assignee.slice(0, 2).toUpperCase();

  return (
    <div style={{
      padding: "16px 24px",
      borderBottom: isLast ? "none" : "1px solid #f1f5f9",
      display: "flex",
      alignItems: "center",
      gap: 16,
      cursor: "pointer",
      transition: "background 0.15s",
    }}>
      <div style={{
        width: 44,
        height: 44,
        borderRadius: 10,
        background: "#f1f5f9",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "#64748b"
      }}>
        <DocumentIcon />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: "#0f172a" }}>
          {isCompliance ? "Compliance information requested" : "Technical information missing"}
        </div>
        <div style={{ fontSize: 13, color: "#475569", marginTop: 2 }}>{system.name}</div>
        <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 2 }}>
          Assigned to: {assignee}
        </div>
      </div>
      <StatusBadge status={system.registration_status} />
      <div style={{ width: 140, textAlign: "right" }}>
        <div style={{ fontSize: 12, color: "#64748b", marginBottom: 6 }}>{dueText}</div>
        <div style={{ height: 6, background: "#e2e8f0", borderRadius: 3, overflow: "hidden" }}>
          <div style={{
            height: "100%",
            width: `${progress}%`,
            background: isCompliance ? "#3b82f6" : "#22c55e",
            borderRadius: 3,
            transition: "width 0.3s ease",
          }} />
        </div>
        <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 4 }}>{progress}% ready</div>
      </div>
      <Avatar
        name={assigneeInitials}
        size="sm"
        style={{
          background: assignee === "Pending" ? "#e2e8f0" : undefined,
          color: assignee === "Pending" ? "#94a3b8" : undefined,
        }}
      />
      <button style={{
        background: "none",
        border: "none",
        padding: 8,
        cursor: "pointer",
        color: "#94a3b8",
        borderRadius: 6,
      }}>
        <ArrowRightIcon />
      </button>
    </div>
  );
}

function SystemRow({ system, onClick }: { system: AISystem; onClick: () => void }) {
  // Get description from intended_purpose or basis
  const description = system.intended_purpose || system.basis || "No description";
  const truncatedDesc = description.length > 40 ? description.slice(0, 40) + "..." : description;

  return (
    <tr onClick={onClick} style={{ cursor: "pointer" }}>
      <td style={tdStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{
            width: 36,
            height: 36,
            borderRadius: 8,
            background: "#f1f5f9",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#64748b"
          }}>
            <DocumentIcon />
          </div>
          <div>
            <div style={{ fontWeight: 600, color: "#0f172a" }}>{system.name}</div>
            <div style={{ fontSize: 12, color: "#64748b" }}>{truncatedDesc}</div>
          </div>
        </div>
      </td>
      <td style={tdStyle}><TierBadge tier={system.tier} /></td>
      <td style={tdStyle}><StatusBadge status={system.registration_status || "draft"} /></td>
      <td style={tdStyle}>
        <WorkflowSteps status={system.registration_status || "draft"} />
      </td>
      <td style={tdStyle}>
        <div style={{ fontSize: 13, color: "#475569" }}>
          <FormattedDate iso={system.updated_at} />
        </div>
      </td>
      <td style={tdStyle}>
        <button style={{
          background: "none",
          border: "none",
          padding: 8,
          cursor: "pointer",
          color: "#94a3b8",
          borderRadius: 6,
        }}>
          <MoreIcon />
        </button>
      </td>
    </tr>
  );
}

function GlanceItem({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: number; color?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 0" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        {icon}
        <span style={{ fontSize: 14, color: "#475569" }}>{label}</span>
      </div>
      <span style={{ fontSize: 18, fontWeight: 700, color: color || "#0f172a" }}>{value}</span>
    </div>
  );
}

function KPICard({ label, value, color, bgColor }: { label: string; value: number; color: string; bgColor: string }) {
  return (
    <div style={{
      background: bgColor,
      borderRadius: 12,
      padding: "16px 20px",
      textAlign: "center",
    }}>
      <div style={{ fontSize: 28, fontWeight: 700, color }}>{value}</div>
      <div style={{ fontSize: 12, color: "#475569", marginTop: 4 }}>{label}</div>
    </div>
  );
}

function PipelineStep({ label, count, color, bgColor, icon, isLast = false }: {
  label: string;
  count: number;
  color: string;
  bgColor: string;
  icon: React.ReactNode;
  isLast?: boolean;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", position: "relative" }}>
      {/* Count label */}
      <div style={{ fontSize: 13, color: "#64748b", marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 700, color, marginBottom: 12 }}>{count}</div>

      {/* Icon circle */}
      <div style={{
        width: 56,
        height: 56,
        borderRadius: "50%",
        background: bgColor,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color,
        position: "relative",
        zIndex: 2,
      }}>
        {icon}
      </div>

      {/* Connecting dashed line with arrow */}
      {!isLast && (
        <div style={{
          position: "absolute",
          right: -16,
          bottom: 28,
          display: "flex",
          alignItems: "center",
          zIndex: 1,
        }}>
          <div style={{
            width: 40,
            height: 0,
            borderTop: "2px dashed #cbd5e1",
          }} />
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ marginLeft: 2 }}>
            <path d="M4 2l4 4-4 4" stroke="#94a3b8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
      )}
    </div>
  );
}

function ActivityItem({ label, system, time, timeDetail, color }: {
  label: string;
  system: string;
  time: string;
  timeDetail: string;
  color: string;
}) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "12px 0", borderBottom: "1px solid #f1f5f9" }}>
      <div style={{ width: 10, height: 10, borderRadius: "50%", background: color, marginTop: 5, flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "#0f172a" }}>{label}</div>
        <div style={{ fontSize: 12, color: "#64748b" }}>{system}</div>
      </div>
      <div style={{ textAlign: "right", flexShrink: 0 }}>
        <div style={{ fontSize: 12, color: "#64748b" }}>{time}</div>
        <div style={{ fontSize: 11, color: "#94a3b8" }}>{timeDetail}</div>
      </div>
    </div>
  );
}

// Styles
const cardStyle: React.CSSProperties = {
  background: "#fff",
  borderRadius: 12,
  border: "1px solid #e2e8f0",
  overflow: "hidden",
};

const cardHeaderStyle: React.CSSProperties = {
  padding: "16px 24px",
  borderBottom: "1px solid #f1f5f9",
};

const sectionNumber: React.CSSProperties = {
  width: 24,
  height: 24,
  borderRadius: "50%",
  background: "#3b82f6",
  color: "#fff",
  fontSize: 12,
  fontWeight: 600,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
};

const sectionTitle: React.CSSProperties = {
  fontSize: 16,
  fontWeight: 600,
  color: "#0f172a",
  margin: 0,
};

const sectionDesc: React.CSSProperties = {
  fontSize: 14,
  color: "#64748b",
  margin: 0,
};

const tableStyle: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
};

const thStyle: React.CSSProperties = {
  textAlign: "left",
  padding: "12px 24px",
  fontSize: 12,
  fontWeight: 500,
  color: "#64748b",
  borderBottom: "1px solid #f1f5f9",
  background: "#fafbfc",
};

const tdStyle: React.CSSProperties = {
  padding: "16px 24px",
  fontSize: 14,
  borderBottom: "1px solid #f1f5f9",
};
