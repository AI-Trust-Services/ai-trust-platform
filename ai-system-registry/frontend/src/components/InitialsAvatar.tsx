import { cn } from "@/lib/utils";

// Lightweight initials avatar — no @radix-ui/react-avatar dependency. Shows up
// to two initials on a background colour deterministically derived from the
// name, so the same owner always renders the same colour.
const PALETTE = [
  "bg-[#e8f0fb] text-[#1147E9]",
  "bg-[#d5f5e3] text-[#1a5c35]",
  "bg-[#fde8d0] text-[#8b3a00]",
  "bg-[#f0e8ff] text-[#4108A0]",
  "bg-[#fff3c4] text-[#7a5900]",
  "bg-[#ffd5d5] text-[#8b0000]",
  "bg-[#c8f0d8] text-[#0d4a28]",
  "bg-[#f4edff] text-[#6C1AF4]",
];

function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

function colorFor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return PALETTE[Math.abs(hash) % PALETTE.length];
}

export default function InitialsAvatar({ name, className }: { name: string; className?: string }) {
  return (
    <span
      className={cn(
        "flex size-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold",
        colorFor(name),
        className,
      )}
      aria-hidden="true"
    >
      {initials(name)}
    </span>
  );
}
