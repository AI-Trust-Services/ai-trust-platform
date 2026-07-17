import { useState, useEffect, useRef } from "react";

export interface MenuItem {
  id?: string;
  label: string;
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
}

interface Props {
  items: MenuItem[];
}

export default function KebabMenu({ items }: Props): JSX.Element {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  return (
    <div className="kebab-wrap" ref={ref}>
      <button
        className="btn-icon kebab-btn"
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        aria-label="More actions"
      >
        ⋮
      </button>
      {open && (
        <div className="kebab-menu">
          {items.map((item, idx) => (
            <button
              key={item.id ?? idx}
              className={`kebab-item${item.danger ? " kebab-item--danger" : ""}`}
              disabled={item.disabled}
              onClick={(e) => { e.stopPropagation(); setOpen(false); item.onClick(); }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
