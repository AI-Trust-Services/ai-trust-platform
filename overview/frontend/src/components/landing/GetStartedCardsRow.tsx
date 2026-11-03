import { Plus, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { navigateTo } from "../../hooks/useLuigi";
import { REGISTRY_URL } from "../../api/client";

interface GetStartedCardsRowProps {
  canRegister: boolean;
}

/**
 * Compliance-officer landing hero: two side-by-side cards.
 *
 * Left card mirrors the owner-view `GetStartedCard` (register flow + EU star
 * ring). Right card is the CO-specific "View all AI Systems" shortcut — the
 * registry table is the CO's main workspace, so it earns top billing instead
 * of the owner-focused "My systems" section.
 */
export function GetStartedCardsRow({ canRegister }: GetStartedCardsRowProps) {
  function handleRegister() {
    sessionStorage.setItem("lastSystemPath", "/systems/new");
    navigateTo("/home/ai-system-registry", REGISTRY_URL);
  }

  function handleViewAll() {
    sessionStorage.setItem("lastSystemPath", "/systems");
    navigateTo("/home/ai-system-registry", REGISTRY_URL);
  }

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold text-foreground">Get started</h2>
      <div className="grid gap-4 md:grid-cols-2">
        <div
          className="relative flex min-h-[180px] flex-col justify-center overflow-hidden rounded-2xl border border-border px-7 py-6"
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
              Once registered, complete the EU AI Act risk classification
              assessment.
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
        <div
          className="relative flex min-h-[180px] flex-col justify-center overflow-hidden rounded-2xl border border-border px-7 py-6"
          style={{
            background:
              "linear-gradient(135deg, #d8d0ff 0%, #c7bbfc 55%, #f1dfb8 100%)",
          }}
        >
          <StackedCardsIllustration />
          <div className="relative flex flex-col gap-2">
            <h3 className="text-xl font-semibold text-foreground">
              View all AI Systems
            </h3>
            <p className="text-sm text-muted-foreground">
              Browse, filter and manage every registered AI system in your
              organization.
            </p>
            <div className="mt-3">
              <Button
                onClick={handleViewAll}
                className="border-transparent bg-[var(--brand)] text-white hover:bg-[color-mix(in_srgb,var(--brand)_88%,black)]"
              >
                View all systems
                <ArrowRight />
              </Button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── Decorative EU star ring (left card) ────────────────────────────────────
// Kept in sync visually with GetStartedCard.tsx — tune constants there, mirror
// here. The two cards sit next to each other on the CO landing, so divergence
// would be jarring.
const RING_CX = 170;
const RING_CY = 55;
const RING_RADIUS = 60;
const STAR_RADIUS = 8;
const STAR_COLOR = "#c8b4e8";
const STAR_OPACITY = 0.45;
const SVG_W_PERCENT = 55;
const SVG_VIEWBOX_W = 220;
const SVG_VIEWBOX_H = 160;

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
    points.push(
      `${cx + Math.cos(angle) * radius},${cy + Math.sin(angle) * radius}`,
    );
  }
  return (
    <polygon points={points.join(" ")} fill={STAR_COLOR} opacity={STAR_OPACITY} />
  );
}

// ─── Decorative stacked-cards shape (right card) ────────────────────────────
// Three offset rounded rectangles to echo the "browse all systems" idea
// without pulling in another illustration asset.
function StackedCardsIllustration() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 220 160"
      className="pointer-events-none absolute right-0 top-0 h-full"
      style={{ width: "55%" }}
      preserveAspectRatio="xMaxYMin meet"
    >
      <rect
        x="100"
        y="22"
        width="110"
        height="30"
        rx="8"
        fill="#ffffff"
        opacity="0.35"
      />
      <rect
        x="90"
        y="58"
        width="120"
        height="30"
        rx="8"
        fill="#ffffff"
        opacity="0.45"
      />
      <rect
        x="80"
        y="94"
        width="130"
        height="30"
        rx="8"
        fill="#ffffff"
        opacity="0.55"
      />
    </svg>
  );
}
