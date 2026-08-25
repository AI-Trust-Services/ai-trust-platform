import { useMemo } from "react";
import {
  Pagination as PaginationRoot,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationPrevious,
  PaginationNext,
  PaginationEllipsis,
} from "@/components/ui/pagination";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

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
    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-1.5 px-1 pt-3">
      <span className="justify-self-start text-[13px] text-muted-foreground">{from}–{to} of {total}</span>
      <PaginationRoot className="mx-0 w-auto justify-self-center">
        <PaginationContent>
          <PaginationItem>
            <PaginationPrevious
              size="sm"
              className={clamped <= 1 ? "pointer-events-none opacity-60" : ""}
              aria-disabled={clamped <= 1}
              onClick={() => { if (clamped > 1) onPageChange(clamped - 1); }}
            />
          </PaginationItem>
          {pages.map((p, i) =>
            p === "…"
              ? <PaginationItem key={`gap-${i}`}><PaginationEllipsis /></PaginationItem>
              : <PaginationItem key={p}>
                  <PaginationLink
                    size="sm"
                    isActive={p === clamped}
                    onClick={() => onPageChange(p)}
                  >{p}</PaginationLink>
                </PaginationItem>
          )}
          <PaginationItem>
            <PaginationNext
              size="sm"
              className={clamped >= pageCount ? "pointer-events-none opacity-60" : ""}
              aria-disabled={clamped >= pageCount}
              onClick={() => { if (clamped < pageCount) onPageChange(clamped + 1); }}
            />
          </PaginationItem>
        </PaginationContent>
      </PaginationRoot>
      <div className="justify-self-end">
        {onPageSizeChange && (
          <Select value={String(pageSize)} onValueChange={(v) => onPageSizeChange(Number(v))}>
            <SelectTrigger className="h-8 w-auto gap-1 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {pageSizeOptions.map((n) => <SelectItem key={n} value={String(n)}>{n} / page</SelectItem>)}
            </SelectContent>
          </Select>
        )}
      </div>
    </div>
  );
}
