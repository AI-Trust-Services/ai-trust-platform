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
    // Same localStorage handoff pattern as `registry.openSystem` so Luigi stays
    // on the top-level /home/ai-system-registry node (deeper routes make Luigi
    // drop the side-nav).
    localStorage.setItem("registry.openNew", "1");
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
 * Each star is a self-contained SVG so it stays round regardless of the
 * container aspect ratio.
 */
function EuStarRing() {
  const starSize = 44;
  // Center the ring in the top-right quadrant of the hero; the ring is large
  // enough that it bleeds past the top and right edges.
  const centerX = 88;
  const centerY = 28;
  const radiusX = 22;
  const radiusY = 32;
  const stars = Array.from({ length: 12 }, (_, i) => {
    const angle = (i / 12) * 2 * Math.PI - Math.PI / 2;
    return {
      left: centerX + Math.cos(angle) * radiusX,
      top: centerY + Math.sin(angle) * radiusY,
    };
  });
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0">
      {stars.map((s, i) => (
        <div
          key={i}
          className="absolute"
          style={{
            left: `${s.left}%`,
            top: `${s.top}%`,
            width: starSize,
            height: starSize,
            transform: "translate(-50%, -50%)",
          }}
        >
          <StarSvg />
        </div>
      ))}
    </div>
  );
}

function StarSvg() {
  const r = 48;
  const cx = 50;
  const cy = 50;
  const points: string[] = [];
  for (let i = 0; i < 10; i++) {
    const angle = (Math.PI / 5) * i - Math.PI / 2;
    const radius = i % 2 === 0 ? r : r / 2.4;
    points.push(
      `${cx + Math.cos(angle) * radius},${cy + Math.sin(angle) * radius}`,
    );
  }
  return (
    <svg
      viewBox="0 0 100 100"
      className="h-full w-full"
      preserveAspectRatio="xMidYMid meet"
    >
      <polygon points={points.join(" ")} fill="#b8a4de" opacity={0.75} />
    </svg>
  );
}
