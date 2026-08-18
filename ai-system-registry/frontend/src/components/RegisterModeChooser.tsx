interface Props {
  open: boolean;
  onClose: () => void;
  onManual: () => void;
  onAssisted: () => void;
}

/**
 * Owner entry point: choose between the classic manual form and the
 * conversational AI-assisted flow. Engineer fill-in mode skips this.
 */
export default function RegisterModeChooser({ open, onClose, onManual, onAssisted }: Props) {
  if (!open) return null;
  return (
    <div className="modal-overlay open" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" style={{ maxWidth: 620 }}>
        <div className="modal-header">
          <h2>Register AI System</h2>
          <button className="btn-close" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          <p style={{ marginBottom: 16, color: "var(--text-secondary)", fontSize: 14 }}>
            How would you like to register this system?
          </p>
          <div className="mode-choice-grid">
            <button className="mode-choice" onClick={onAssisted}>
              <div className="mode-choice-icon">✨</div>
              <div className="mode-choice-title">AI-Assisted</div>
              <div className="mode-choice-desc">
                Describe your system in plain language. The assistant asks a few questions,
                infers the EU AI Act classification, and fills in the details for you.
              </div>
            </button>
            <button className="mode-choice" onClick={onManual}>
              <div className="mode-choice-icon">📝</div>
              <div className="mode-choice-title">Manual</div>
              <div className="mode-choice-desc">
                Enter a name and description, then assign an AI Engineer to complete the
                technical details and risk flags.
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
