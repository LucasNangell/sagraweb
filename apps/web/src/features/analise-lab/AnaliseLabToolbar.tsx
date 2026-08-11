import {
  BetweenHorizontalStart,
  Columns2,
  Grid3X3,
  Maximize,
  Ruler,
  Square,
  ZoomIn,
  ZoomOut,
} from "lucide-react";

import type { AnaliseLabTool } from "./AnaliseLabMarkTools";
import type { InspectorViewMode } from "./analiseLabFit";
import type { InspectorViewPrefs } from "./analiseLabViewPrefs";
import {
  AnaliseLabMarkCreateOptions,
  type AnaliseLabMarkCreateOptionsProps,
} from "./AnaliseLabMarkCreateOptions";

const inputClass =
  "h-7 rounded border border-sagra-border bg-white px-1.5 text-[11px]";
const btnBase =
  "inline-flex h-7 items-center justify-center rounded border px-1.5 text-[11px]";
const btnIdle = `${btnBase} border-sagra-border bg-white text-neutral-700 hover:bg-neutral-50`;
const btnActive =
  `${btnBase} border-primary-green bg-primary-green/10 text-primary-green`;
const colorInputClass =
  "h-6 w-7 cursor-pointer rounded border border-sagra-border bg-white p-0.5";
const divider = "mx-0.5 hidden h-6 w-px shrink-0 bg-sagra-border sm:block";

export type AnaliseLabToolbarMarkProps = AnaliseLabMarkCreateOptionsProps & {
  tool: AnaliseLabTool;
  onToolChange: (tool: AnaliseLabTool) => void;
};

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
  /** Oculta a 2ª barra (opções movidas para o painel do problema). */
  hideMarkOptions?: boolean;
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
  hideMarkOptions = false,
}: AnaliseLabToolbarProps) {
  const hasGuides =
    prefs.guidesXMm.length > 0 || prefs.guidesYMm.length > 0;
  const showOptions = !hideMarkOptions && mark.tool !== "select";

  const {
    onToolChange: _onToolChange,
    ...createOptions
  } = mark;

  return (
    <div className="shrink-0">
      <div className="flex flex-wrap items-center gap-1.5 border-b border-sagra-border bg-white px-2 py-1.5">
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
          <button
            type="button"
            onClick={() => onPrefsChange({ ...prefs, offset: !prefs.offset })}
            className={prefs.offset ? btnActive : btnIdle}
            title="Offset de corte (auxiliar)"
            aria-label="Offset de corte"
            aria-pressed={prefs.offset}
          >
            <BetweenHorizontalStart className="size-3.5" aria-hidden />
          </button>
          {prefs.offset ? (
            <>
              <label className="flex items-center gap-1 text-[11px] text-neutral-600">
                mm
                <input
                  type="number"
                  min={0.5}
                  max={100}
                  step={0.5}
                  value={prefs.offsetMm}
                  onChange={(e) =>
                    onPrefsChange({
                      ...prefs,
                      offsetMm: Number(e.target.value) || 7,
                    })
                  }
                  className={`${inputClass} w-12`}
                />
              </label>
              <input
                type="color"
                value={prefs.offsetColor}
                onChange={(e) =>
                  onPrefsChange({ ...prefs, offsetColor: e.target.value })
                }
                className={colorInputClass}
                title="Cor do offset"
                aria-label="Cor do offset"
              />
            </>
          ) : null}
        </div>
      </div>

      {showOptions ? <AnaliseLabMarkCreateOptions {...createOptions} /> : null}
    </div>
  );
}
