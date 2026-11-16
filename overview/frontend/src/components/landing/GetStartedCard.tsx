import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { navigateTo } from "../../hooks/useLuigi";
import { REGISTRY_URL } from "../../api/client";

interface GetStartedCardProps {
  canRegister: boolean;
}

export function GetStartedCard({ canRegister }: GetStartedCardProps) {
  function handleRegister() {
    // Same sessionStorage trampoline the registry MFE reads on Luigi init.
    // Keeps the side-nav visible because Luigi stays on the top-level node.
    sessionStorage.setItem("lastSystemPath", "/systems/new");
    navigateTo("/home/ai-system-registry", REGISTRY_URL);
  }

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold text-foreground">Get started</h2>
      <div
        className="relative flex min-h-[180px] flex-col justify-center overflow-hidden rounded-2xl border border-border px-8 py-7"
        style={{
          background:
            "linear-gradient(135deg, #ece6ff 0%, #efe8ff 40%, #fdf0d9 100%)",
        }}
      >
        <EuStarRing />
        <div className="relative flex flex-col gap-2">
          <h3 className="text-xl font-semibold text-foreground">
            Register an AI System
          </h3>
          <p className="text-sm text-muted-foreground">
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

// ─── EU star ring — tune the look here ──────────────────────────────────────
// Edit any of these constants to change the ring. SVG uses `xMaxYMin meet` so
// the viewBox is pinned to the top-right of the card; `cx`/`cy` move the ring
// inside that pinned box.
const RING_CX = 170;          // horizontal center of the ring (viewBox units)
const RING_CY = 55;           // vertical center of the ring (viewBox units)
const RING_RADIUS = 60;       // distance from center to each star
const STAR_RADIUS = 8;        // outer radius of each star
const STAR_COLOR = "#c8b4e8"; // star fill — close to card background, slightly darker
const STAR_OPACITY = 0.45;    // 0 = invisible, 1 = fully opaque
const SVG_W_PERCENT = 55;     // SVG container width as % of card
const SVG_VIEWBOX_W = 220;    // viewBox width in SVG units
const SVG_VIEWBOX_H = 160;    // viewBox height in SVG units
// ───────────────────────────────────────────────────────────────────────────

function EuStarRing() {
  const stars = Array.from({ length: 12 }, (_, i) => {
    const angle = (i / 12) * 2 * Math.PI - Math.PI / 2;
    return {
      cx: RING_CX + Math.cos(angle) * RING_RADIUS,
      cy: RING_CY + Math.sin(angle) * RING_RADIUS,
    };
  });
  return (
    <svg
      aria-hidden="true"
      viewBox={`0 0 ${SVG_VIEWBOX_W} ${SVG_VIEWBOX_H}`}
      className="pointer-events-none absolute right-0 top-0 h-full"
      style={{ width: `${SVG_W_PERCENT}%` }}
      preserveAspectRatio="xMaxYMin meet"
    >
      {stars.map((s, i) => (
        <Star key={i} cx={s.cx} cy={s.cy} r={STAR_RADIUS} />
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
  return <polygon points={points.join(" ")} fill={STAR_COLOR} opacity={STAR_OPACITY} />;
}
