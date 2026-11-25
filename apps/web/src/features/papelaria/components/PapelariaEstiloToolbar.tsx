import { Bold } from "lucide-react";

import { cn } from "@sagra/ui";

import type { CampoExtraAlignH, CampoExtraAlignV } from "@/features/papelaria/papelariaCamposExtras";

import { PapelariaAlignPicker } from "./PapelariaAlignPicker";

export type PapelariaEstiloToolbarProps = {
  tamanhoPt: number;
  onTamanhoPt: (v: number) => void;
  align_h: CampoExtraAlignH;
  align_v: CampoExtraAlignV;
  onAlign: (next: { align_h: CampoExtraAlignH; align_v: CampoExtraAlignV }) => void;
  /** Negrito (só texto). */
  mostrarNegrito?: boolean;
  negritoAtivo?: boolean;
  onNegrito?: () => void;
  /** Posição em mm (extras). */
  mostrarMm?: boolean;
  xMm?: number;
  yMm?: number;
  onXMm?: (v: number) => void;
  onYMm?: (v: number) => void;
  className?: string;
};

const campoCls =
  "h-7 rounded-md border border-sagra-border bg-white px-1.5 text-xs text-neutral-800 outline-none focus:border-secondary-blue focus:ring-1 focus:ring-secondary-blue/30";

const rotuloCls = "text-[10px] font-semibold uppercase tracking-wide text-neutral-500";

/** Controles de tipografia/alinhamento compartilhados (criar extra e editar campo). */
export function PapelariaEstiloToolbar({
  tamanhoPt,
  onTamanhoPt,
  align_h,
  align_v,
  onAlign,
  mostrarNegrito = false,
  negritoAtivo = false,
  onNegrito,
  mostrarMm = false,
  xMm = 0,
  yMm = 0,
  onXMm,
  onYMm,
  className,
}: PapelariaEstiloToolbarProps) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-2 gap-y-1.5 border-b border-sagra-border/70 pb-2",
        className,
      )}
    >
      <label className="inline-flex h-7 items-center gap-1.5">
        <span className={rotuloCls}>pt</span>
        <input
          type="number"
          min={4}
          max={72}
          step={0.5}
          value={tamanhoPt}
          data-testid="papelaria-extra-tamanho"
          className={cn(campoCls, "w-14 tabular-nums")}
          onChange={(e) => onTamanhoPt(Number(e.target.value) || 11)}
        />
      </label>

      {mostrarNegrito && onNegrito ? (
        <button
          type="button"
          title="Negrito na seleção"
          aria-label="Negrito"
          aria-pressed={negritoAtivo}
          data-testid="papelaria-extra-negrito"
          className={cn(
            "inline-flex size-7 shrink-0 items-center justify-center rounded-md border transition-colors",
            negritoAtivo
              ? "border-secondary-blue bg-secondary-blue/10 text-secondary-blue"
              : "border-sagra-border bg-white text-neutral-700 hover:bg-slate-50",
          )}
          onMouseDown={(e) => e.preventDefault()}
          onClick={onNegrito}
        >
          <Bold className="size-3.5" aria-hidden strokeWidth={negritoAtivo ? 2.75 : 2} />
        </button>
      ) : null}

      <div className="mx-0.5 h-5 w-px shrink-0 bg-sagra-border/80" aria-hidden />

      <div className="inline-flex h-7 items-center gap-1.5">
        <span className={rotuloCls}>Âncora</span>
        <PapelariaAlignPicker align_h={align_h} align_v={align_v} onChange={onAlign} />
      </div>

      {mostrarMm ? (
        <>
          <div className="mx-0.5 h-5 w-px shrink-0 bg-sagra-border/80" aria-hidden />
          <label className="inline-flex h-7 items-center gap-1.5">
            <span className={rotuloCls}>X</span>
            <input
              type="number"
              step={0.1}
              value={xMm}
              data-testid="papelaria-extra-x-mm"
              className={cn(campoCls, "w-16 tabular-nums")}
              onChange={(e) => onXMm?.(Number(e.target.value) || 0)}
            />
            <span className="text-[10px] text-neutral-400">mm</span>
          </label>
          <label className="inline-flex h-7 items-center gap-1.5">
            <span className={rotuloCls}>Y</span>
            <input
              type="number"
              step={0.1}
              value={yMm}
              data-testid="papelaria-extra-y-mm"
              className={cn(campoCls, "w-16 tabular-nums")}
              onChange={(e) => onYMm?.(Number(e.target.value) || 0)}
            />
            <span className="text-[10px] text-neutral-400">mm</span>
          </label>
        </>
      ) : null}
    </div>
  );
}
