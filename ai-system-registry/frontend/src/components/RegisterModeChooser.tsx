interface Props {
  open: boolean;
  onClose: () => void;
  onManual: () => void;
  onAssisted: () => void;
  title?: string;
  assistedDescription?: string;
  manualDescription?: string;
}

function IconSparkle() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/>
      <path d="M20 3v4m2-2h-4M4 17v2m1-1H3"/>
    </svg>
  );
}

function IconForm() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="3" width="16" height="18" rx="2"/>
      <path d="M8 7h8M8 11h8M8 15h5"/>
    </svg>
  );
}

export default function RegisterModeChooser({ open, onClose, onManual, onAssisted, title = "Register AI System", assistedDescription, manualDescription }: Props) {
  if (!open) return null;
  return (
    <div className="modal-overlay open" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" style={{ maxWidth: 560 }}>
        <div className="modal-header">
          <h2>{title}</h2>
          <button className="btn-close" onClick={onClose}>×</button>
        </div>
        <div className="modal-body" style={{ padding: 24 }}>
          <p style={{ marginBottom: 20, fontSize: 14, fontWeight: 500, color: "var(--text)" }}>
            How would you like to proceed?
          </p>
          <div className="mode-choice-grid">
            <button className="mode-choice" onClick={onAssisted}>
              <div className="mode-choice-icon mode-choice-icon-ai"><IconSparkle /></div>
              <div className="mode-choice-title">AI-Assisted</div>
              <div className="mode-choice-desc">
                {assistedDescription ?? "Describe your system in plain language. The assistant asks a few questions, infers the EU AI Act classification, and fills in the details for you."}
              </div>
            </button>
            <button className="mode-choice" onClick={onManual}>
              <div className="mode-choice-icon mode-choice-icon-manual"><IconForm /></div>
              <div className="mode-choice-title">Manual</div>
              <div className="mode-choice-desc">
                {manualDescription ?? "Enter a name and description, then assign an AI Engineer to complete the technical details and risk flags."}
              </div>
            </button>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
