export function fmtDateTime(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso.replace(" ", "T") + "Z").toLocaleString();
  } catch {
    return iso;
  }
}

export function fmtAge(iso: string | null): string {
  if (!iso) return "—";
  try {
    const ms = Date.now() - new Date(iso.replace(" ", "T") + "Z").getTime();
    const s = Math.floor(ms / 1000);
    if (s < 60) return `${s}s ago`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    const rm = m % 60;
    if (h < 24) return rm > 0 ? `${h}h ${rm}m ago` : `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
  } catch {
    return iso;
  }
}

export function fmtValue(ruleName: string, value: number | null): string | null {
  if (value === null || value === undefined) return null;
  const name = ruleName.toLowerCase();
  if (name.includes("compliance") && name.includes("average"))
    return `Average compliance when triggered: ${value.toFixed(1)}%`;
  if (name.includes("compliance"))
    return `Systems with low compliance: ${value}`;
  if (name.includes("latency"))
    return `Average latency when triggered: ${value.toFixed(0)}ms`;
  if (name.includes("signal"))
    return `Signals received in window: ${value}`;
  if (name.includes("prohibited"))
    return `Prohibited systems in registry: ${value}`;
  return `Value when triggered: ${value}`;
}
