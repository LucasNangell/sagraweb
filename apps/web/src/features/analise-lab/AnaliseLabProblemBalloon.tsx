import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { forwardRef, useMemo } from "react";

import type { AnaliseLabItem } from "@/api/analiseLab";

import { toBalloonHtml } from "./analiseLabBalloonHtml";

interface AnaliseLabProblemBalloonProps {
  item: AnaliseLabItem;
  refNumber: number;
  width?: number;
  highlighted?: boolean;
  occurrences: number[];
  occurrenceIndex: number;
  onOccurrenceChange: (index: number) => void;
  onClose: () => void;
  style?: React.CSSProperties;
}

export const AnaliseLabProblemBalloon = forwardRef<
  HTMLDivElement,
  AnaliseLabProblemBalloonProps
>(function AnaliseLabProblemBalloon(
  {
    item,
    refNumber,
    width = 280,
    highlighted = false,
    occurrences,
    occurrenceIndex,
    onOccurrenceChange,
    onClose,
    style,
  },
  ref,
) {
  const total = occurrences.length;
  const page = occurrences[occurrenceIndex] ?? item.pagina;
  const bodyHtml = useMemo(
    () => toBalloonHtml(item.htmlSnapshot || "", item.titulo),
    [item.htmlSnapshot, item.titulo],
  );

  return (
    <div
      ref={ref}
      data-analise-lab-balloon
      className={
        highlighted
          ? "pointer-events-auto overflow-hidden rounded-xl border-2 border-primary-green bg-white shadow-xl"
          : "pointer-events-auto overflow-hidden rounded-xl border border-sagra-border bg-white shadow-lg"
      }
      style={{ ...style, width }}
      onWheel={(event) => {
        // O estágio do folhear usa wheel para virar página; sobre o balão
        // o scroll deve só rolar o conteúdo.
        event.stopPropagation();
      }}
    >
      <div className="flex items-start gap-2 border-b border-sagra-border bg-slate-50 px-2.5 py-2">
        <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-secondary-blue text-[11px] font-bold text-white">
          {refNumber}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-xs font-semibold text-neutral-900">
            {item.titulo}
          </h3>
          <p className="truncate text-[10px] text-neutral-500">
            {item.componente}
            {item.escopo === "arquivo" ? " · arquivo" : ""}
            {page ? ` · pág. ${page}` : ""}
          </p>
        </div>
        <button
          type="button"
          className="rounded p-0.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
          onClick={onClose}
          aria-label="Fechar"
        >
          <X className="size-3.5" aria-hidden />
        </button>
      </div>

      {total > 1 ? (
        <div className="flex items-center justify-between gap-1 border-b border-sagra-border px-2 py-1">
          <button
            type="button"
            disabled={occurrenceIndex <= 0}
            className="rounded p-0.5 disabled:opacity-40"
            onClick={() => onOccurrenceChange(Math.max(0, occurrenceIndex - 1))}
          >
            <ChevronLeft className="size-3.5" aria-hidden />
          </button>
          <span className="tabular-nums text-[10px] text-neutral-600">
            {occurrenceIndex + 1}/{total}
          </span>
          <button
            type="button"
            disabled={occurrenceIndex >= total - 1}
            className="rounded p-0.5 disabled:opacity-40"
            onClick={() =>
              onOccurrenceChange(Math.min(total - 1, occurrenceIndex + 1))
            }
          >
            <ChevronRight className="size-3.5" aria-hidden />
          </button>
        </div>
      ) : null}

      <div
        className={
          "max-h-[220px] overflow-auto px-2.5 py-2 text-[11px] leading-snug text-neutral-800 " +
          "[&_p]:mb-1.5 [&_ul]:mb-1.5 [&_ul]:list-disc [&_ul]:pl-4 " +
          "[&_ol]:mb-1.5 [&_ol]:list-decimal [&_ol]:pl-4 [&_li]:my-0.5 " +
          "[&_h1]:mb-1 [&_h1]:text-xs [&_h1]:font-semibold " +
          "[&_h2]:mb-1 [&_h2]:text-xs [&_h2]:font-semibold " +
          "[&_h3]:mb-1 [&_h3]:text-[11px] [&_h3]:font-semibold " +
          "[&_h4]:mb-1 [&_h4]:text-[11px] [&_h4]:font-semibold " +
          "[&_img]:my-1 [&_img]:max-w-full [&_img]:rounded " +
          "[&_table]:my-1 [&_table]:w-full [&_table]:border-collapse " +
          "[&_td]:border [&_td]:border-neutral-200 [&_td]:px-1 [&_td]:py-0.5 " +
          "[&_th]:border [&_th]:border-neutral-200 [&_th]:px-1 [&_th]:py-0.5 [&_th]:text-left " +
          "[&_a]:text-secondary-blue [&_a]:underline"
        }
      >
        {bodyHtml ? (
          <div dangerouslySetInnerHTML={{ __html: bodyHtml }} />
        ) : (
          <p className="text-neutral-400">(Sem conteúdo)</p>
        )}
      </div>
    </div>
  );
});
