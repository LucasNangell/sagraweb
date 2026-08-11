import { MousePointerClick } from "lucide-react";
import { useMemo } from "react";

import type {
  AnaliseLabEdge,
  AnaliseLabMarkCor,
} from "@/api/analiseLab";

import {
  COLOR_OPTIONS,
  EDGE_OPTIONS,
  EDGE_OPTIONS_SANGRIA,
  labelCor,
  labelEdge,
} from "./analiseLabLabels";
import {
  parsePageSpec,
  validatePageSpec,
} from "./analiseLabPageSpec";
import type { AnaliseLabTool } from "./AnaliseLabMarkTools";

const inputClass =
  "h-7 rounded border border-sagra-border bg-white px-1.5 text-[11px]";
const btnBase =
  "inline-flex h-7 items-center justify-center rounded border px-1.5 text-[11px]";
const btnIdle = `${btnBase} border-sagra-border bg-white text-neutral-700 hover:bg-neutral-50`;
const btnActive =
  `${btnBase} border-primary-green bg-primary-green/10 text-primary-green`;
const btnPrimary =
  "inline-flex h-7 items-center rounded bg-secondary-blue px-2 text-[11px] font-semibold text-white disabled:opacity-50";
const divider = "mx-0.5 hidden h-6 w-px shrink-0 bg-sagra-border sm:block";

export interface AnaliseLabMarkCreateOptionsProps {
  tool: AnaliseLabTool;
  edge: AnaliseLabEdge;
  onEdgeChange: (edge: AnaliseLabEdge) => void;
  offsetMm: number;
  onOffsetMmChange: (v: number) => void;
  fromMm: number;
  onFromMmChange: (v: number) => void;
  sangriaMm: number;
  onSangriaMmChange: (v: number) => void;
  applyAllPages: boolean;
  onApplyAllPagesChange: (v: boolean) => void;
  pageSpec: string;
  onPageSpecChange: (v: string) => void;
  pagePickActive: boolean;
  onTogglePagePick: () => void;
  espelhar: boolean;
  onEspelharChange: (v: boolean) => void;
  cor: AnaliseLabMarkCor;
  onCorChange: (c: AnaliseLabMarkCor) => void;
  rotulo: string;
  onRotuloChange: (v: string) => void;
  espessura: number;
  onEspessuraChange: (v: number) => void;
  onAddFaixa: () => void;
  onAddSangriaAll: () => void;
  busy?: boolean;
  className?: string;
}

/** Opções de criação da marca (ex-segunda barra do inspector). */
export function AnaliseLabMarkCreateOptions({
  tool,
  edge,
  onEdgeChange,
  offsetMm,
  onOffsetMmChange,
  fromMm,
  onFromMmChange,
  sangriaMm,
  onSangriaMmChange,
  applyAllPages,
  onApplyAllPagesChange,
  pageSpec,
  onPageSpecChange,
  pagePickActive,
  onTogglePagePick,
  espelhar,
  onEspelharChange,
  cor,
  onCorChange,
  rotulo,
  onRotuloChange,
  espessura,
  onEspessuraChange,
  onAddFaixa,
  onAddSangriaAll,
  busy = false,
  className = "flex flex-wrap items-center gap-1.5 border-b border-sagra-border bg-neutral-50 px-2 py-1.5",
}: AnaliseLabMarkCreateOptionsProps) {
  const pageSpecError = useMemo(() => {
    if (applyAllPages) return null;
    if (pagePickActive && !pageSpec.trim()) return null;
    if (!pageSpec.trim()) return "Informe as páginas.";
    return validatePageSpec(pageSpec);
  }, [applyAllPages, pageSpec, pagePickActive]);

  const multiPageScope = useMemo(() => {
    if (applyAllPages) return true;
    if (pageSpecError) return false;
    try {
      return parsePageSpec(pageSpec).length > 1;
    } catch {
      return false;
    }
  }, [applyAllPages, pageSpec, pageSpecError]);

  if (tool === "select") return null;

  const showMirror =
    multiPageScope &&
    (tool === "faixa" ||
      tool === "sangria" ||
      tool === "retangulo" ||
      tool === "seta" ||
      tool === "circulo" ||
      tool === "texto");
  const insertDisabled =
    busy ||
    (!applyAllPages && (Boolean(pageSpecError) || !pageSpec.trim()));
  const showStroke =
    tool === "seta" || tool === "circulo" || tool === "livre";
  const sangriaAll = edge === "all";

  return (
    <div className={className}>
      <div className="flex flex-wrap items-center gap-1">
        {tool === "faixa" && (
          <>
            <label className="flex items-center gap-1 text-[11px] text-neutral-600">
              Borda
              <select
                value={edge}
                onChange={(e) =>
                  onEdgeChange(e.target.value as AnaliseLabEdge)
                }
                className={inputClass}
              >
                {EDGE_OPTIONS.map((e) => (
                  <option key={e} value={e}>
                    {labelEdge(e)}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-1 text-[11px] text-neutral-600">
              De
              <input
                type="number"
                min={0}
                step={0.5}
                value={fromMm}
                onChange={(e) => onFromMmChange(Number(e.target.value) || 0)}
                className={`${inputClass} w-14`}
              />
            </label>
            <label className="flex items-center gap-1 text-[11px] text-neutral-600">
              Até
              <input
                type="number"
                min={0}
                step={0.5}
                value={offsetMm}
                onChange={(e) => onOffsetMmChange(Number(e.target.value) || 0)}
                className={`${inputClass} w-14`}
              />
            </label>
            <button
              type="button"
              disabled={insertDisabled}
              onClick={onAddFaixa}
              className={btnPrimary}
            >
              Inserir
            </button>
          </>
        )}

        {tool === "sangria" && (
          <>
            <label className="flex items-center gap-1 text-[11px] text-neutral-600">
              Borda
              <select
                value={edge}
                onChange={(e) =>
                  onEdgeChange(e.target.value as AnaliseLabEdge)
                }
                className={inputClass}
              >
                {EDGE_OPTIONS_SANGRIA.map((e) => (
                  <option key={e} value={e}>
                    {labelEdge(e)}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-1 text-[11px] text-neutral-600">
              Prof. mm
              <input
                type="number"
                min={0.5}
                max={50}
                step={0.5}
                value={sangriaMm}
                onChange={(e) =>
                  onSangriaMmChange(Number(e.target.value) || 5)
                }
                className={`${inputClass} w-14`}
              />
            </label>
            {sangriaAll ? (
              <button
                type="button"
                disabled={insertDisabled}
                onClick={onAddSangriaAll}
                className={btnPrimary}
              >
                Inserir
              </button>
            ) : (
              <span className="text-[10px] text-neutral-500">
                Arraste na borda (−{sangriaMm || 5}→0)
              </span>
            )}
          </>
        )}

        {showStroke ? (
          <label className="flex items-center gap-1 text-[11px] text-neutral-600">
            Espessura
            <select
              value={espessura}
              onChange={(e) =>
                onEspessuraChange(Number(e.target.value) || 2)
              }
              className={inputClass}
            >
              <option value={1}>Fina</option>
              <option value={2}>Média</option>
              <option value={3}>Grossa</option>
            </select>
          </label>
        ) : null}

        <label className="flex items-center gap-1 text-[11px] text-neutral-600">
          Cor
          <select
            value={cor}
            onChange={(e) =>
              onCorChange(e.target.value as AnaliseLabMarkCor)
            }
            className={inputClass}
          >
            {COLOR_OPTIONS.map((c) => (
              <option key={c} value={c}>
                {labelCor(c)}
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-1 text-[11px] text-neutral-600">
          Rótulo
          <input
            value={rotulo}
            onChange={(e) => onRotuloChange(e.target.value)}
            maxLength={120}
            placeholder="Opcional"
            className={`${inputClass} w-24`}
          />
        </label>
      </div>

      <span className={divider} aria-hidden />

      <div className="flex flex-wrap items-center gap-1.5">
        <label className="flex items-center gap-1 text-[11px] text-neutral-700">
          <input
            type="checkbox"
            checked={applyAllPages}
            onChange={(e) => onApplyAllPagesChange(e.target.checked)}
          />
          Todas
        </label>
        {!applyAllPages ? (
          <>
            <label className="flex items-center gap-1 text-[11px] text-neutral-600">
              Págs.
              <input
                value={pageSpec}
                onChange={(e) => onPageSpecChange(e.target.value)}
                placeholder={
                  pagePickActive ? "Clique nas páginas" : "1-15,20"
                }
                className={`${inputClass} w-24 ${pageSpecError ? "border-sagra-danger" : ""}`}
                title={pageSpecError ?? undefined}
              />
            </label>
            <button
              type="button"
              onClick={onTogglePagePick}
              className={pagePickActive ? btnActive : btnIdle}
              title="Selecionar páginas clicando no documento"
              aria-label="Selecionar páginas clicando no documento"
              aria-pressed={pagePickActive}
            >
              <MousePointerClick className="size-3.5" aria-hidden />
            </button>
          </>
        ) : null}
        {showMirror ? (
          <label className="flex items-center gap-1 text-[11px] text-neutral-700">
            <input
              type="checkbox"
              checked={espelhar}
              onChange={(e) => onEspelharChange(e.target.checked)}
            />
            Espelhar
          </label>
        ) : null}
      </div>
    </div>
  );
}
