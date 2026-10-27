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
    navigateTo(
      "/home/ai-system-registry/systems/new",
      `${REGISTRY_URL}#/systems/new`,
    );
  }

  return (
    <div
      className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden rounded-2xl"
      style={{
        background:
          "linear-gradient(135deg, rgba(236,230,255,0.78) 0%, rgba(239,232,255,0.75) 40%, rgba(253,240,217,0.78) 100%)",
        backdropFilter: "blur(2px)",
        WebkitBackdropFilter: "blur(2px)",
      }}
    >
      <StarField />
      <div className="pointer-events-auto relative flex max-w-xl flex-col items-center gap-5 px-6 py-12 text-center">
        <h2 className="text-2xl font-semibold leading-tight text-foreground">
          Simplify your{" "}
          <span className="text-[var(--brand)]">AI assessment</span> process,
          <br />
          let us guide you there.
        </h2>
        <p className="max-w-md text-sm text-muted-foreground">
          Get started by registering an AI System.
          <br />
          Once registered, complete the EU AI Act risk classification
          assessment.
        </p>
        {canRegister && (
          <Button
            onClick={handleRegister}
            className="mt-1 border-transparent bg-[var(--brand)] text-white hover:bg-[color-mix(in_srgb,var(--brand)_88%,black)]"
          >
            <Plus />
            Register new AI System
          </Button>
        )}
      </div>
    </div>
  );
}

/** Scattered EU-style stars sprinkled across the whole curtain. */
function StarField() {
  const stars = [
    { x: 6, y: 8, r: 1.6 },
    { x: 15, y: 20, r: 1.2 },
    { x: 24, y: 5, r: 1.4 },
    { x: 32, y: 15, r: 1.0 },
    { x: 46, y: 7, r: 1.5 },
    { x: 58, y: 12, r: 1.1 },
    { x: 70, y: 4, r: 1.6 },
    { x: 82, y: 10, r: 1.3 },
    { x: 92, y: 18, r: 1.5 },
    { x: 4, y: 32, r: 1.3 },
    { x: 94, y: 36, r: 1.0 },
    { x: 10, y: 48, r: 1.2 },
    { x: 90, y: 50, r: 1.4 },
    { x: 6, y: 62, r: 1.6 },
    { x: 95, y: 68, r: 1.2 },
    { x: 14, y: 80, r: 1.1 },
    { x: 26, y: 92, r: 1.4 },
    { x: 42, y: 86, r: 1.0 },
    { x: 58, y: 92, r: 1.3 },
    { x: 72, y: 85, r: 1.5 },
    { x: 86, y: 94, r: 1.1 },
  ];
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      className="pointer-events-none absolute inset-0 h-full w-full"
    >
      {stars.map((s, i) => (
        <Star key={i} cx={s.x} cy={s.y} r={s.r} />
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
  return <polygon points={points.join(" ")} fill="#c8b8e6" opacity={0.55} />;
}
