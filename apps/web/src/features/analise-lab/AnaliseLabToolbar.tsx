import {
  Columns2,
  Grid3X3,
  Maximize,
  MousePointerClick,
  Ruler,
  Square,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
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
import {
  TOOLS,
  type AnaliseLabTool,
} from "./AnaliseLabMarkTools";
import type { InspectorViewMode } from "./analiseLabFit";
import type { InspectorViewPrefs } from "./analiseLabViewPrefs";

const inputClass =
  "h-7 rounded border border-sagra-border bg-white px-1.5 text-[11px]";
const btnBase =
  "inline-flex h-7 items-center justify-center rounded border px-1.5 text-[11px]";
const btnIdle = `${btnBase} border-sagra-border bg-white text-neutral-700 hover:bg-neutral-50`;
const btnActive =
  `${btnBase} border-primary-green bg-primary-green/10 text-primary-green`;
const btnPrimary =
  "inline-flex h-7 items-center rounded bg-secondary-blue px-2 text-[11px] font-semibold text-white disabled:opacity-50";
const colorInputClass =
  "h-6 w-7 cursor-pointer rounded border border-sagra-border bg-white p-0.5";
const divider = "mx-0.5 hidden h-6 w-px shrink-0 bg-sagra-border sm:block";

export interface AnaliseLabToolbarMarkProps {
  tool: AnaliseLabTool;
  onToolChange: (tool: AnaliseLabTool) => void;
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
  onAddOffset: () => void;
  onAddFaixa: () => void;
  onAddSangriaAll: () => void;
  busy?: boolean;
}

interface AnaliseLabToolbarProps {
  mark: AnaliseLabToolbarMarkProps;
  prefs: InspectorViewPrefs;
  onPrefsChange: (prefs: InspectorViewPrefs) => void;
  activePage: number;
  pageCount: number;
  zoom: number;
  fitMode: boolean;
  viewMode: InspectorViewMode;
  sizeLabel: string;
  onZoomOut: () => void;
  onZoomIn: () => void;
  onZoom100: () => void;
  onFit: () => void;
  onToggleViewMode: () => void;
}

export function AnaliseLabToolbar({
  mark,
  prefs,
  onPrefsChange,
  activePage,
  pageCount,
  zoom,
  fitMode,
  viewMode,
  sizeLabel,
  onZoomOut,
  onZoomIn,
  onZoom100,
  onFit,
  onToggleViewMode,
}: AnaliseLabToolbarProps) {
  const {
    tool,
    onToolChange,
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
    onAddOffset,
    onAddFaixa,
    onAddSangriaAll,
    busy = false,
  } = mark;

  const pageSpecError = useMemo(() => {
    if (applyAllPages) return null;
    return validatePageSpec(pageSpec);
  }, [applyAllPages, pageSpec]);

  const multiPageScope = useMemo(() => {
    if (applyAllPages) return true;
    if (pageSpecError) return false;
    try {
      return parsePageSpec(pageSpec).length > 1;
    } catch {
      return false;
    }
  }, [applyAllPages, pageSpec, pageSpecError]);

  const showMirror =
    multiPageScope &&
    (tool === "offset_corte" ||
      tool === "faixa" ||
      tool === "sangria" ||
      tool === "retangulo" ||
      tool === "seta" ||
      tool === "circulo" ||
      tool === "texto");
  const insertDisabled = busy || (!applyAllPages && Boolean(pageSpecError));
  const showStroke =
    tool === "seta" || tool === "circulo" || tool === "livre";
  const sangriaAll = edge === "all";
  const showOptions = tool !== "select";
  const hasGuides =
    prefs.guidesXMm.length > 0 || prefs.guidesYMm.length > 0;

  return (
    <div className="shrink-0">
      <div className="flex flex-wrap items-center gap-1.5 border-b border-sagra-border bg-white px-2 py-1.5">
        <div className="flex flex-wrap items-center gap-0.5">
          {TOOLS.map((t) => (
            <button
              key={t.id}
              type="button"
              disabled={busy}
              title={t.label}
              aria-label={t.label}
              onClick={() => onToolChange(t.id)}
              className={
                tool === t.id
                  ? "inline-flex size-7 items-center justify-center rounded bg-primary-green text-white"
                  : "inline-flex size-7 items-center justify-center rounded border border-sagra-border bg-white text-neutral-700 hover:bg-neutral-50"
              }
            >
              {t.icon}
            </button>
          ))}
        </div>

        <span className={divider} aria-hidden />

        <div className="flex flex-wrap items-center gap-1">
          <span className="tabular-nums text-[11px] text-neutral-700">
            Pág. {activePage}/{pageCount}
          </span>
          <button
            type="button"
            onClick={onZoomOut}
            className={btnIdle}
            title="Diminuir zoom (Ctrl+-)"
            aria-label="Diminuir zoom"
          >
            <ZoomOut className="size-3.5" aria-hidden />
          </button>
          <button
            type="button"
            onClick={onZoomIn}
            className={btnIdle}
            title="Aumentar zoom (Ctrl++)"
            aria-label="Aumentar zoom"
          >
            <ZoomIn className="size-3.5" aria-hidden />
          </button>
          <button
            type="button"
            onClick={onZoom100}
            className={btnIdle}
            title="100%"
          >
            100%
          </button>
          <button
            type="button"
            onClick={onFit}
            className={fitMode ? btnActive : btnIdle}
            title="Ajustar à área (Ctrl+0)"
            aria-label="Ajustar à área"
          >
            <Maximize className="size-3.5" aria-hidden />
          </button>
          <button
            type="button"
            onClick={onToggleViewMode}
            className={viewMode === "dupla" ? btnActive : btnIdle}
            title={
              viewMode === "dupla"
                ? "Página dupla (ativada)"
                : "Ativar página dupla"
            }
            aria-label="Alternar página dupla"
          >
            {viewMode === "dupla" ? (
              <Columns2 className="size-3.5" aria-hidden />
            ) : (
              <Square className="size-3.5" aria-hidden />
            )}
          </button>
          <span className="tabular-nums text-[11px] text-neutral-500">
            {Math.round(zoom * 100)}% · {sizeLabel}
          </span>
        </div>

        <span className={divider} aria-hidden />

        <div className="flex flex-wrap items-center gap-1">
          <button
            type="button"
            onClick={() => onPrefsChange({ ...prefs, rulers: !prefs.rulers })}
            className={prefs.rulers ? btnActive : btnIdle}
            title="Réguas"
            aria-label="Réguas"
            aria-pressed={prefs.rulers}
          >
            <Ruler className="size-3.5" aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => onPrefsChange({ ...prefs, grid: !prefs.grid })}
            className={prefs.grid ? btnActive : btnIdle}
            title="Linhas de grade"
            aria-label="Linhas de grade"
            aria-pressed={prefs.grid}
          >
            <Grid3X3 className="size-3.5" aria-hidden />
          </button>
          {prefs.grid ? (
            <>
              <label className="flex items-center gap-1 text-[11px] text-neutral-600">
                mm
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={prefs.gridStepMm}
                  onChange={(e) =>
                    onPrefsChange({
                      ...prefs,
                      gridStepMm: Number(e.target.value) || 10,
                    })
                  }
                  className={`${inputClass} w-12`}
                />
              </label>
              <input
                type="color"
                value={prefs.gridColor}
                onChange={(e) =>
                  onPrefsChange({ ...prefs, gridColor: e.target.value })
                }
                className={colorInputClass}
                title="Cor da grade"
                aria-label="Cor da grade"
              />
            </>
          ) : null}
          <button
            type="button"
            onClick={() => onPrefsChange({ ...prefs, guides: !prefs.guides })}
            className={prefs.guides ? btnActive : btnIdle}
            title="Linhas guia"
            aria-label="Linhas guia"
            aria-pressed={prefs.guides}
          >
            Guia
          </button>
          {prefs.guides ? (
            <input
              type="color"
              value={prefs.guideColor}
              onChange={(e) =>
                onPrefsChange({ ...prefs, guideColor: e.target.value })
              }
              className={colorInputClass}
              title="Cor das guias"
              aria-label="Cor das guias"
            />
          ) : null}
          <button
            type="button"
            disabled={!hasGuides}
            onClick={() =>
              onPrefsChange({ ...prefs, guidesXMm: [], guidesYMm: [] })
            }
            className={`${btnIdle} disabled:opacity-40`}
            title="Limpar guias"
          >
            Limpar
          </button>
        </div>
      </div>

      {showOptions ? (
        <div className="flex flex-wrap items-center gap-1.5 border-b border-sagra-border bg-neutral-50 px-2 py-1.5">
          <div className="flex flex-wrap items-center gap-1">
            {(tool === "offset_corte" || tool === "faixa") && (
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
                {tool === "faixa" ? (
                  <label className="flex items-center gap-1 text-[11px] text-neutral-600">
                    De
                    <input
                      type="number"
                      min={0}
                      step={0.5}
                      value={fromMm}
                      onChange={(e) =>
                        onFromMmChange(Number(e.target.value) || 0)
                      }
                      className={`${inputClass} w-14`}
                    />
                  </label>
                ) : null}
                <label className="flex items-center gap-1 text-[11px] text-neutral-600">
                  {tool === "offset_corte" ? "Offset" : "Até"}
                  <input
                    type="number"
                    min={0}
                    step={0.5}
                    value={offsetMm}
                    onChange={(e) =>
                      onOffsetMmChange(Number(e.target.value) || 0)
                    }
                    className={`${inputClass} w-14`}
                  />
                </label>
                <button
                  type="button"
                  disabled={insertDisabled}
                  onClick={tool === "offset_corte" ? onAddOffset : onAddFaixa}
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
                    placeholder="1-15,20"
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
      ) : null}
    </div>
  );
}
