import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { forwardRef, useMemo, useState } from "react";

import type {
  AnaliseLabItem,
  AnaliseLabItemProvidencia,
} from "@/api/analiseLab";

import { BALLOON_EXPAND_H, BALLOON_PREFERRED_H } from "./analiseLabBalloons";
import { toBalloonHtml } from "./analiseLabBalloonHtml";

interface AnaliseLabProblemBalloonProps {
  item: AnaliseLabItem;
  refNumber: number;
  width?: number;
  highlighted?: boolean;
  /** Em repouso: usa restHeight; no hover/focus expande. */
  collapsed?: boolean;
  restHeight?: number;
  expandHeight?: number;
  /** @deprecated use restHeight */
  collapsedHeight?: number;
  stackIndex?: number;
  occurrences: number[];
  occurrenceIndex: number;
  onOccurrenceChange: (index: number) => void;
  onClose: () => void;
  onHoverChange?: (active: boolean) => void;
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
    collapsed = false,
    restHeight,
    expandHeight = BALLOON_EXPAND_H,
    collapsedHeight,
    stackIndex: _stackIndex = 0,
    occurrences,
    occurrenceIndex,
    onOccurrenceChange,
    onClose,
    onHoverChange,
    style,
  },
  ref,
) {
  const [showProvidencias, setShowProvidencias] = useState(false);
  const [focused, setFocused] = useState(false);
  const total = occurrences.length;
  const page = occurrences[occurrenceIndex] ?? item.pagina;
  const bodyHtml = useMemo(
    () =>
      toBalloonHtml(item.htmlSnapshot || "", item.titulo, {
        stripProvidencias: true,
      }),
    [item.htmlSnapshot, item.titulo],
  );
  const selectedProvidencias = useMemo(
    () =>
      (item.providencias ?? []).filter(
        (p: AnaliseLabItemProvidencia) => p.selecionada,
      ),
    [item.providencias],
  );

  const rest = restHeight ?? collapsedHeight ?? BALLOON_PREFERRED_H;
  // Expansão só por interação explícita (hover/focus via collapsed=false, ou Ver providências).
  const expanded = !collapsed || focused || showProvidencias;

  return (
    <div
      ref={ref}
      data-analise-lab-balloon
      tabIndex={0}
      className={
        highlighted
          ? "pointer-events-auto flex flex-col overflow-hidden rounded-xl border-2 border-primary-green bg-white shadow-xl transition-[height,max-height,box-shadow] duration-150"
          : "pointer-events-auto flex flex-col overflow-hidden rounded-xl border border-sagra-border bg-white shadow-lg transition-[height,max-height,box-shadow] duration-150"
      }
      style={{
        ...style,
        width,
        // Em repouso: altura fixa = slot do pack (sem sobrepor vizinhos).
        height: expanded ? undefined : rest,
        maxHeight: expanded ? expandHeight : rest,
        boxShadow: expanded
          ? "0 12px 28px rgba(15, 23, 42, 0.28)"
          : undefined,
      }}
      onMouseEnter={() => {
        onHoverChange?.(true);
      }}
      onMouseLeave={() => {
        if (!focused && !showProvidencias) onHoverChange?.(false);
      }}
      onFocus={() => {
        setFocused(true);
        onHoverChange?.(true);
      }}
      onBlur={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        setFocused(false);
        if (!showProvidencias) onHoverChange?.(false);
      }}
      onWheel={(event) => {
        event.stopPropagation();
      }}
    >
      <div className="flex shrink-0 items-start gap-2 border-b border-sagra-border bg-slate-50 px-2.5 py-2">
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
            {item.resolucaoObrigatoria ? " · obrigatória" : ""}
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
        <div className="flex shrink-0 items-center justify-between gap-1 border-b border-sagra-border px-2 py-1">
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
          "min-h-0 flex-1 overflow-auto px-2.5 py-2 text-[11px] leading-snug text-neutral-800 " +
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

      {selectedProvidencias.length > 0 ? (
        <div className="shrink-0 border-t border-sagra-border px-2.5 py-1.5">
          <button
            type="button"
            className="text-[10px] font-semibold text-secondary-blue hover:underline"
            onClick={() => setShowProvidencias((v) => !v)}
          >
            {showProvidencias ? "Ocultar providências" : "Ver providências"}
          </button>
          {showProvidencias ? (
            <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[11px] text-neutral-800">
              {selectedProvidencias.map((p) => (
                <li key={p.id}>{p.texto}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
});
