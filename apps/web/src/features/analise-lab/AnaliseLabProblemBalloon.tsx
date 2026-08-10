import { ChevronLeft, ChevronRight, X } from "lucide-react";

import type { AnaliseLabItem } from "@/api/analiseLab";
import { AnaliseHtmlViewer } from "@/features/analise/components/AnaliseHtmlViewer";

interface AnaliseLabProblemBalloonProps {
  item: AnaliseLabItem;
  refNumber: number;
  highlighted?: boolean;
  occurrences: number[];
  occurrenceIndex: number;
  onOccurrenceChange: (index: number) => void;
  onClose: () => void;
  style?: React.CSSProperties;
}

export function AnaliseLabProblemBalloon({
  item,
  refNumber,
  highlighted = false,
  occurrences,
  occurrenceIndex,
  onOccurrenceChange,
  onClose,
  style,
}: AnaliseLabProblemBalloonProps) {
  const total = occurrences.length;
  const page = occurrences[occurrenceIndex] ?? item.pagina;

  return (
    <div
      className={
        highlighted
          ? "pointer-events-auto w-[210px] overflow-hidden rounded-xl border-2 border-primary-green bg-white shadow-xl"
          : "pointer-events-auto w-[210px] overflow-hidden rounded-xl border border-sagra-border bg-white shadow-lg"
      }
      style={style}
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

      <div className="max-h-[220px] overflow-auto px-2 py-1.5 text-[11px]">
        <AnaliseHtmlViewer
          html={item.htmlSnapshot || ""}
          itemTitulo={item.titulo}
        />
      </div>
    </div>
  );
}
