import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { navigateTo } from "../../hooks/useLuigi";
import { REGISTRY_URL } from "../../api/client";

interface GetStartedCardProps {
  canRegister: boolean;
}

export function GetStartedCard({ canRegister }: GetStartedCardProps) {
  function handleRegister() {
    // Same localStorage handoff pattern as `registry.openSystem` so Luigi stays
    // on the top-level /home/ai-system-registry node (deeper routes make Luigi
    // drop the side-nav).
    localStorage.setItem("registry.openNew", "1");
    navigateTo("/home/ai-system-registry", REGISTRY_URL);
  }

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold text-foreground">Get started</h2>
      <div
        className="relative flex min-h-[220px] flex-col justify-end overflow-hidden rounded-2xl border border-border p-6"
        style={{
          background:
            "linear-gradient(135deg, #ece6ff 0%, #efe8ff 40%, #fdf0d9 100%)",
        }}
      >
        <EuStarRing />
        <div className="relative flex flex-col gap-1.5">
          <h3 className="text-base font-semibold text-foreground">
            Register an AI System
          </h3>
          <p className="max-w-sm text-xs text-muted-foreground">
            Once registered, complete the EU AI Act risk classification assessment.
          </p>
          {canRegister && (
            <div className="mt-3">
              <Button
                onClick={handleRegister}
                className="border-transparent bg-[var(--brand)] text-white hover:bg-[color-mix(in_srgb,var(--brand)_88%,black)]"
              >
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

/** 12-star EU ring motif. 12 five-pointed stars arranged on a circle. */
function EuStarRing() {
  const cx = 160;
  const cy = 80;
  const ringRadius = 55;
  const starRadius = 6;
  const stars = Array.from({ length: 12 }, (_, i) => {
    const angle = (i / 12) * 2 * Math.PI - Math.PI / 2;
    return {
      cx: cx + Math.cos(angle) * ringRadius,
      cy: cy + Math.sin(angle) * ringRadius,
    };
  });
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 320 160"
      className="pointer-events-none absolute right-0 top-0 h-full w-[45%]"
      preserveAspectRatio="xMidYMid meet"
    >
      {stars.map((s, i) => (
        <Star key={i} cx={s.cx} cy={s.cy} r={starRadius} />
      ))}
    </svg>
  );
}

function Star({ cx, cy, r }: { cx: number; cy: number; r: number }) {
  const points: string[] = [];
  for (let i = 0; i < 10; i++) {
    const angle = (Math.PI / 5) * i - Math.PI / 2;
    const radius = i % 2 === 0 ? r : r / 2.4;
    points.push(`${cx + Math.cos(angle) * radius},${cy + Math.sin(angle) * radius}`);
  }
  return <polygon points={points.join(" ")} fill="#c8b8e6" opacity={0.7} />;
}
