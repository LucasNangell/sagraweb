import type { WheelEvent } from "react";

import { pdfCompareAssetUrl } from "./api";
import type { ComparePage } from "./types";

interface OsPdfComparePagesColumnProps {
  pages: ComparePage[];
  pageIndex: number;
  onPageIndexChange: (index: number) => void;
}

function severityClass(page: ComparePage): string {
  if (page.status !== "compared") return "sev-critical";
  if (page.changedPercent <= 0.01) return "sev-none";
  if (page.changedPercent < 0.5) return "sev-low";
  if (page.changedPercent < 2) return "sev-mid";
  return "sev-high";
}

function fmtPct(n: number): string {
  if (!Number.isFinite(n)) return "0%";
  if (n < 0.01) return "0%";
  if (n < 1) return `${n.toFixed(2)}%`;
  return `${n.toFixed(1)}%`;
}

function onPagesWheel(e: WheelEvent<HTMLDivElement>) {
  const el = e.currentTarget;
  if (Math.abs(e.deltaY) < Math.abs(e.deltaX)) return;
  if (e.deltaY === 0) return;
  const maxScroll = el.scrollHeight - el.clientHeight;
  if (maxScroll <= 0) return;
  const next = Math.min(maxScroll, Math.max(0, el.scrollTop + e.deltaY));
  if (next === el.scrollTop) return;
  e.preventDefault();
  el.scrollTop = next;
}

export function OsPdfComparePagesColumn({
  pages,
  pageIndex,
  onPageIndexChange,
}: OsPdfComparePagesColumnProps) {
  const active = pages.find((p) => p.index === pageIndex) || pages[0] || null;

  return (
    <aside className="os-pdf-panel os-pdf-pages-column" aria-label="Páginas">
      <h2>Páginas</h2>
      <div className="os-pdf-thumbs-vertical" onWheel={onPagesWheel}>
        {pages.map((p) => {
          const thumb = pdfCompareAssetUrl(p.urls.thumb);
          return (
            <button
              key={p.index}
              type="button"
              className={
                "os-pdf-thumb " +
                severityClass(p) +
                (active && p.index === active.index ? " active" : "")
              }
              onClick={() => onPageIndexChange(p.index)}
              title={`Página ${p.pageNumber} · ${fmtPct(p.changedPercent)}`}
            >
              {thumb ? <img src={thumb} alt={`Pág. ${p.pageNumber}`} /> : null}
              <span>
                {p.pageNumber} · {fmtPct(p.changedPercent)}
              </span>
            </button>
          );
        })}
      </div>
    </aside>
  );
}
