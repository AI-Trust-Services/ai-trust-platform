import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { navigateTo } from "../../hooks/useLuigi";
import { REGISTRY_URL } from "../../api/client";

interface GetStartedCardProps {
  canRegister: boolean;
}

export function GetStartedCard({ canRegister }: GetStartedCardProps) {
  function handleRegister() {
    navigateTo("/home/ai-system-registry/systems/new", `${REGISTRY_URL}#/systems/new`);
  }

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold text-foreground">Get started</h2>
      <div
        className="relative overflow-hidden rounded-2xl border border-border p-8"
        style={{
          background:
            "linear-gradient(135deg, #ece6ff 0%, #efe8ff 40%, #fdf0d9 100%)",
        }}
      >
        <StarsMotif />
        <div className="relative flex flex-col gap-2">
          <h3 className="text-xl font-semibold text-foreground">
            Register an AI System
          </h3>
          <p className="max-w-md text-sm text-muted-foreground">
            Once registered, complete the EU AI Act risk classification assessment.
          </p>
          {canRegister && (
            <div className="mt-4">
              <Button onClick={handleRegister}>
                <Plus />
                Register new AI System
              </Button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function StarsMotif() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 320 200"
      className="pointer-events-none absolute right-0 top-0 h-full w-1/2 opacity-60"
      preserveAspectRatio="xMaxYMid slice"
    >
      {STAR_POINTS.map((p, i) => (
        <Star key={i} cx={p.cx} cy={p.cy} r={p.r} />
      ))}
    </svg>
  );
}

const STAR_POINTS = [
  { cx: 60, cy: 30, r: 5 },
  { cx: 110, cy: 70, r: 4 },
  { cx: 160, cy: 50, r: 3 },
  { cx: 220, cy: 20, r: 4 },
  { cx: 260, cy: 60, r: 5 },
  { cx: 190, cy: 100, r: 3 },
  { cx: 90, cy: 130, r: 4 },
  { cx: 240, cy: 140, r: 3 },
  { cx: 290, cy: 100, r: 4 },
];

function Star({ cx, cy, r }: { cx: number; cy: number; r: number }) {
  const points: string[] = [];
  for (let i = 0; i < 10; i++) {
    const angle = (Math.PI / 5) * i - Math.PI / 2;
    const radius = i % 2 === 0 ? r : r / 2.3;
    points.push(`${cx + Math.cos(angle) * radius},${cy + Math.sin(angle) * radius}`);
  }
  return <polygon points={points.join(" ")} fill="#c8b8e6" opacity={0.55} />;
}
