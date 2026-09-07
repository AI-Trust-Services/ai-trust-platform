import { GripVertical } from "lucide-react";
import { useEffect, useRef, useState } from "react";

interface Props {
  initialWidth?: number;
  minWidth?: number;
  maxWidth?: number;
  /** Storage key so the user's choice survives reloads. */
  storageKey?: string;
  children: React.ReactNode;
}

/**
 * Resizable sidebar with a drag handle on its right edge. Pointer events used
 * (not mouse-only) so this works on trackpad + touchscreen alike. Width is
 * persisted to localStorage when storageKey is provided.
 */
export function ResizableSidebar({
  initialWidth = 320,
  minWidth = 220,
  maxWidth = 600,
  storageKey,
  children,
}: Props) {
  const [width, setWidth] = useState(() => {
    if (!storageKey) return initialWidth;
    const stored = parseInt(localStorage.getItem(storageKey) ?? "", 10);
    return Number.isFinite(stored) && stored >= minWidth && stored <= maxWidth
      ? stored
      : initialWidth;
  });
  const dragState = useRef<{ startX: number; startWidth: number } | null>(null);

  // Persist on width change (debounced through React's batching — fine for this).
  useEffect(() => {
    if (storageKey) localStorage.setItem(storageKey, String(width));
  }, [width, storageKey]);

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    dragState.current = { startX: e.clientX, startWidth: width };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const s = dragState.current;
    if (!s) return;
    const next = Math.min(maxWidth, Math.max(minWidth, s.startWidth + (e.clientX - s.startX)));
    setWidth(next);
  }

  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    dragState.current = null;
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
  }

  return (
    <div style={{ ...styles.wrap, width }}>
      {children}
      <div
        style={styles.handle}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        title="Drag to resize"
        role="separator"
        aria-orientation="vertical"
      >
        <GripVertical style={styles.handleIcon as React.CSSProperties} />
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrap: {
    position: "relative",
    flexShrink: 0,
    display: "flex",
    flexDirection: "column" as const,
    minWidth: 0,
  },
  handle: {
    position: "absolute",
    top: 0,
    right: -3,
    width: 6,
    height: "100%",
    cursor: "col-resize",
    zIndex: 1,
    background: "transparent",
    // The handle is intentionally narrow (6px) so it doesn't eat layout space,
    // but the grip icon sits absolutely centred on top of it so it can be
    // wider than the hit area without affecting size.
    overflow: "visible" as const,
    // Visible hover affordance — a thin brand-coloured line on hover
    transition: "background 120ms",
  },
  // Grip glyph centred on the handle so the user has a clear visual cue that
  // the column is resizable. Positioned absolutely so it can render wider than
  // the 6px handle without enlarging the hit zone. Half-transparent at rest so
  // it doesn't dominate the layout. pointerEvents:none lets clicks fall through
  // to the handle div, which owns the pointer-capture logic.
  handleIcon: {
    position: "absolute" as const,
    top: "50%",
    left: "50%",
    transform: "translate(-50%, -50%)",
    width: 14,
    height: 14,
    color: "var(--color-text-secondary)",
    opacity: 0.6,
    pointerEvents: "none" as const,
  },
};
