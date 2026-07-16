interface KpiCardProps {
  label: string;
  value: number | string;
  sub?: string;
}

export default function KpiCard({ label, value, sub }: KpiCardProps): JSX.Element {
  return (
    <div className="kpi-card">
      <div className="kpi-value">{value}</div>
      <div className="kpi-label">{label}</div>
      {sub && <div className="kpi-sub">{sub}</div>}
    </div>
  );
}
