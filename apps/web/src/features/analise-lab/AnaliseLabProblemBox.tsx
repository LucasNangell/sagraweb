import { ChevronLeft, ChevronRight } from "lucide-react";

import type { AnaliseLabItem } from "@/api/analiseLab";
import { AnaliseHtmlViewer } from "@/features/analise/components/AnaliseHtmlViewer";

interface AnaliseLabProblemBoxProps {
  item: AnaliseLabItem;
  occurrences: number[];
  occurrenceIndex: number;
  onOccurrenceChange: (index: number) => void;
  onClose: () => void;
}

export function AnaliseLabProblemBox({
  item,
  occurrences,
  occurrenceIndex,
  onOccurrenceChange,
  onClose,
}: AnaliseLabProblemBoxProps) {
  const total = occurrences.length;
  const page = occurrences[occurrenceIndex] ?? item.pagina;

  return (
    <aside className="flex w-80 shrink-0 flex-col gap-2 overflow-hidden border-l border-sagra-border bg-white p-3 text-sm">
      <div className="flex items-start justify-between gap-2">
        <h2 className="text-sm font-semibold text-neutral-800">{item.titulo}</h2>
        <button type="button" className="text-xs text-neutral-500" onClick={onClose}>
          Fechar
        </button>
      </div>
      <p className="text-[11px] text-neutral-500">
        {item.componente}
        {item.escopo === "arquivo" ? " · arquivo" : null}
      </p>

      {total > 1 ? (
        <div className="flex items-center justify-between gap-1 rounded border border-sagra-border bg-neutral-50 px-2 py-1">
          <button
            type="button"
            disabled={occurrenceIndex <= 0}
            className="rounded p-0.5 disabled:opacity-40"
            onClick={() => onOccurrenceChange(Math.max(0, occurrenceIndex - 1))}
          >
            <ChevronLeft className="size-4" aria-hidden />
          </button>
          <span className="tabular-nums text-xs text-neutral-700">
            Ocorrência {occurrenceIndex + 1} de {total} · página {page}
          </span>
          <button
            type="button"
            disabled={occurrenceIndex >= total - 1}
            className="rounded p-0.5 disabled:opacity-40"
            onClick={() =>
              onOccurrenceChange(Math.min(total - 1, occurrenceIndex + 1))
            }
          >
            <ChevronRight className="size-4" aria-hidden />
          </button>
        </div>
      ) : page ? (
        <p className="text-xs text-neutral-500">Página {page}</p>
      ) : null}

      <div className="min-h-0 flex-1 overflow-auto rounded border border-sagra-border">
        <AnaliseHtmlViewer html={item.htmlSnapshot || ""} itemTitulo={item.titulo} />
      </div>
    </aside>
  );
}
