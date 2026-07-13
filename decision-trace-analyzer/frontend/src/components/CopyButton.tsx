import "@ui5/webcomponents-icons/dist/copy.js";
import "@ui5/webcomponents-icons/dist/accept.js";
import { useState } from "react";

interface Props {
  value: string;
  title?: string;
}

/** Small icon button that copies `value` to the clipboard and briefly shows a check mark. */
export function CopyButton({ value, title = "Copy" }: Props) {
  const [copied, setCopied] = useState(false);

  async function copy(e: React.MouseEvent) {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      // Clipboard API may be blocked in some contexts (HTTP, iframe sandbox); silently ignore.
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      title={copied ? "Copied!" : title}
      style={styles.btn}
    >
      {/* @ts-ignore */}
      <ui5-icon name={copied ? "accept" : "copy"} style={styles.icon} />
    {/* @ts-ignore */}
    </button>
  );
}

const styles: Record<string, React.CSSProperties> = {
  btn: {
    background: "transparent",
    border: "none",
    cursor: "pointer",
    padding: 2,
    margin: 0,
    display: "inline-flex",
    alignItems: "center",
    color: "var(--color-text-secondary)",
    verticalAlign: "middle",
  },
  icon: { width: 12, height: 12 } as React.CSSProperties,
};
