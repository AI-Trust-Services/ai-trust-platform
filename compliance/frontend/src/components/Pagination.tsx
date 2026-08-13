import { useMemo } from "react";

interface PaginationProps {
  page: number;                 // 1-indexed
  pageSize: number;
  total: number;                // total items (after filtering)
  onPageChange: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
  pageSizeOptions?: number[];
}

/**
 * Client-side pagination bar. Renders a range summary, page-size selector, and
 * prev/next + numbered buttons. Purely presentational — the parent slices its
 * own data by (page, pageSize).
 */
export default function Pagination({
  page, pageSize, total, onPageChange, onPageSizeChange,
  pageSizeOptions = [10, 25, 50, 100],
}: PaginationProps) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const clamped = Math.min(page, pageCount);
  const from = total === 0 ? 0 : (clamped - 1) * pageSize + 1;
  const to = Math.min(clamped * pageSize, total);

  // Compact page window: first, last, and a window around the current page.
  const pages = useMemo(() => {
    const out: (number | "…")[] = [];
    const window = 1;
    for (let p = 1; p <= pageCount; p++) {
      if (p === 1 || p === pageCount || (p >= clamped - window && p <= clamped + window)) {
        out.push(p);
      } else if (out[out.length - 1] !== "…") {
        out.push("…");
      }
    }
    return out;
  }, [pageCount, clamped]);

  if (total === 0) return null;

  return (
    <div className="pagination">
      <span className="pagination-summary">{from}–{to} of {total}</span>
      <div className="pagination-nav">
        <button className="btn-ghost btn-sm" disabled={clamped <= 1} onClick={() => onPageChange(clamped - 1)}>‹ Prev</button>
        {pages.map((p, i) =>
          p === "…"
            ? <span key={`gap-${i}`} className="pagination-gap">…</span>
            : <button
                key={p}
                className={`btn-ghost btn-sm pagination-page${p === clamped ? " active" : ""}`}
                onClick={() => onPageChange(p)}
              >{p}</button>
        )}
        <button className="btn-ghost btn-sm" disabled={clamped >= pageCount} onClick={() => onPageChange(clamped + 1)}>Next ›</button>
      </div>
      <div className="pagination-size-wrap">
        {onPageSizeChange && (
          <select
            className="filter-select pagination-size"
            value={pageSize}
            onChange={(e) => onPageSizeChange(Number(e.target.value))}
          >
            {pageSizeOptions.map((n) => <option key={n} value={n}>{n} / page</option>)}
          </select>
        )}
      </div>
    </div>
  );
}