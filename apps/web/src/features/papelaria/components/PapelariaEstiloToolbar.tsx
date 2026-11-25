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
        "flex flex-wrap items-center gap-2 border-b border-slate-100 pb-2",
        className,
      )}
    >
      <label className="flex items-center gap-1 text-[10px] font-medium text-neutral-600">
        pt
        <input
          type="number"
          min={4}
          max={72}
          step={0.5}
          value={tamanhoPt}
          data-testid="papelaria-extra-tamanho"
          className="w-14 rounded border border-slate-300 px-1 py-0.5 text-xs"
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
            "inline-flex size-7 items-center justify-center rounded border text-neutral-700 hover:bg-slate-50",
            negritoAtivo
              ? "border-secondary-blue bg-secondary-blue/15 text-secondary-blue"
              : "border-slate-300",
          )}
          onMouseDown={(e) => e.preventDefault()}
          onClick={onNegrito}
        >
          <Bold className="size-3.5" aria-hidden strokeWidth={negritoAtivo ? 2.75 : 2} />
        </button>
      ) : null}
      <PapelariaAlignPicker align_h={align_h} align_v={align_v} onChange={onAlign} />
      {mostrarMm ? (
        <>
          <label className="flex items-center gap-1 text-[10px] font-medium text-neutral-600">
            X mm
            <input
              type="number"
              step={0.1}
              value={xMm}
              data-testid="papelaria-extra-x-mm"
              className="w-16 rounded border border-slate-300 px-1 py-0.5 text-xs"
              onChange={(e) => onXMm?.(Number(e.target.value) || 0)}
            />
          </label>
          <label className="flex items-center gap-1 text-[10px] font-medium text-neutral-600">
            Y mm
            <input
              type="number"
              step={0.1}
              value={yMm}
              data-testid="papelaria-extra-y-mm"
              className="w-16 rounded border border-slate-300 px-1 py-0.5 text-xs"
              onChange={(e) => onYMm?.(Number(e.target.value) || 0)}
            />
          </label>
        </>
      ) : null}
    </div>
  );
}
