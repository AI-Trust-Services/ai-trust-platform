import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { navigateTo } from "../../hooks/useLuigi";
import { REGISTRY_URL } from "../../api/client";

interface HeroEmptyStateProps {
  canRegister: boolean;
}

/**
 * Translucent curtain overlaid on top of the (preview) tables when the user
 * has no systems and no assigned tasks. The curtain spans the whole content
 * column so the mock rows beneath it stay visible as "this is what it'll look
 * like" preview.
 */
export function HeroEmptyState({ canRegister }: HeroEmptyStateProps) {
  function handleRegister() {
    // Same sessionStorage trampoline the registry MFE reads on Luigi init.
    // Keeps the side-nav visible because Luigi stays on the top-level node.
    sessionStorage.setItem("lastSystemPath", "/systems/new");
    navigateTo("/home/ai-system-registry", REGISTRY_URL);
  }

  return (
    <div
      className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden"
      style={{
        background:
          "linear-gradient(135deg, rgba(224,214,255,0.92) 0%, rgba(234,220,255,0.88) 35%, rgba(252,228,190,0.92) 100%)",
        backdropFilter: "blur(2px)",
        WebkitBackdropFilter: "blur(2px)",
      }}
    >
      <EuStarRing />
      <div className="pointer-events-auto relative z-10 flex max-w-2xl flex-col items-center gap-6 px-6 py-12 text-center">
        <h2 className="text-4xl font-semibold leading-[1.15] tracking-tight text-foreground">
          Simplify your{" "}
          <span className="text-[var(--brand)]">AI assessment</span> process,
          <br />
          let us guide you there.
        </h2>
        <p className="max-w-lg text-base text-muted-foreground">
          Get started by registering an AI System.
          <br />
          Once registered, complete the EU AI Act risk classification
          assessment.
        </p>
        {canRegister && (
          <Button
            onClick={handleRegister}
            size="lg"
            className="mt-2 border-transparent bg-[var(--brand)] text-white hover:bg-[color-mix(in_srgb,var(--brand)_88%,black)]"
          >
            <Plus />
            Register new AI System
          </Button>
        )}
      </div>
    </div>
  );
}

/**
 * 12 EU-style stars arranged on a circle in the top-right of the hero.
 * SVG with square viewBox + `preserveAspectRatio="xMinYMin meet"` keeps the
 * ring geometrically circular regardless of the hero container's aspect ratio;
 * the SVG itself is sized to roughly half the hero so the ring sits in the
 * top-right quadrant with its edge stars bleeding past the corner.
 */
function EuStarRing() {
  const cx = 270;
  const cy = 135;
  const ringRadius = 150;
  const starRadius = 20;
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
      viewBox="0 0 400 400"
      className="pointer-events-none absolute right-0 top-0 h-[95%] w-[55%]"
      preserveAspectRatio="xMaxYMin meet"
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
    points.push(
      `${cx + Math.cos(angle) * radius},${cy + Math.sin(angle) * radius}`,
    );
  }
  return <polygon points={points.join(" ")} fill="#b8a4de" opacity={0.75} />;
}
