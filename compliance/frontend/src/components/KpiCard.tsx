import { Card } from "@/components/ui/card";

interface KpiCardProps {
  label: string;
  value: number | string;
  sub?: string;
}

export default function KpiCard({ label, value, sub }: KpiCardProps) {
  return (
    <Card className="min-w-[140px] flex-1 p-4">
      <div className="text-2xl font-bold leading-tight tabular-nums text-foreground">{value}</div>
      <div className="mt-1 text-[11px] font-medium text-muted-foreground">{label}</div>
      {sub && <div className="mt-0.5 text-[11px] text-muted-foreground">{sub}</div>}
    </Card>
  );
}
