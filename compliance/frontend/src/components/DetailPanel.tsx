import type { ReactNode } from "react";

interface DetailPanelProps {
  title: string;
  subtitle?: string;
  badge?: string;
  onClose: () => void;
  children: ReactNode;
}

export default function DetailPanel({ title, subtitle, badge, onClose, children }: DetailPanelProps) {
  return (
    <div className="detail-panel-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="detail-panel">
        <div className="detail-panel-header">
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="detail-panel-title">{title}</div>
            {subtitle && <div className="detail-panel-subtitle">{subtitle}</div>}
          </div>
          {badge && <span className="detail-panel-badge">{badge}</span>}
          <button className="btn-close" onClick={onClose}>×</button>
        </div>
        <div className="detail-panel-body">{children}</div>
      </div>
    </div>
  );
}

interface DetailFieldProps { label: string; children: ReactNode; }
export function DetailField({ label, children }: DetailFieldProps) {
  return (
    <div className="dp-field">
      <span className="dp-label">{label}</span>
      <span className="dp-value">{children}</span>
    </div>
  );
}

interface DetailSectionProps { title: string; children: ReactNode; }
export function DetailSection({ title, children }: DetailSectionProps) {
  return (
    <div className="dp-section">
      <div className="dp-section-title">{title}</div>
      {children}
    </div>
  );
}
