interface Props {
  message: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({ message, confirmLabel = "Delete", onConfirm, onCancel }: Props) {
  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal confirm-dialog" onClick={e => e.stopPropagation()}>
        <div className="modal-body" style={{ padding: "28px 24px 20px" }}>
          <p style={{ fontSize: 14, color: "#1d2d3e", lineHeight: 1.5 }}>{message}</p>
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onCancel}>Cancel</button>
          <button className="btn btn-danger" onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}
