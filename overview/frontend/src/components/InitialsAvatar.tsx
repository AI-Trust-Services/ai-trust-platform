import { cn } from "@/lib/utils";

interface InitialsAvatarProps {
  firstName?: string | null;
  lastName?: string | null;
  username?: string | null;
  className?: string;
  size?: "sm" | "md";
}

/**
 * Deterministic initials avatar. Falls back to the first two chars of username
 * if neither first- nor last-name is present. Background colour is picked
 * deterministically from the username so the same user always gets the same
 * colour across the app.
 */
export function InitialsAvatar({
  firstName,
  lastName,
  username,
  className,
  size = "md",
}: InitialsAvatarProps) {
  const initials = resolveInitials({ firstName, lastName, username });
  const bg = pickColor(username || `${firstName}${lastName}` || "?");
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white",
        size === "sm" ? "size-6 text-[10px]" : "size-9 text-xs",
        className,
      )}
      style={{ background: bg }}
      aria-hidden="true"
    >
      {initials}
    </span>
  );
}

function resolveInitials({
  firstName,
  lastName,
  username,
}: Pick<InitialsAvatarProps, "firstName" | "lastName" | "username">): string {
  const f = (firstName || "").trim();
  const l = (lastName || "").trim();
  if (f || l) {
    return `${f.charAt(0)}${l.charAt(0)}`.toUpperCase() || "?";
  }
  const u = (username || "").trim();
  return u.slice(0, 2).toUpperCase() || "?";
}

const PALETTE = [
  "#1147E9",
  "#6C1AF4",
  "#0E7490",
  "#B45309",
  "#15803D",
  "#9333EA",
  "#DB2777",
  "#059669",
];

function pickColor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  return PALETTE[Math.abs(hash) % PALETTE.length];
}
