import {
  BetweenHorizontalStart,
  Columns2,
  Crop,
  Grid3X3,
  Maximize,
  MoveDiagonal,
  Ruler,
  Square,
  Trash2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";

import type { AnaliseLabTool } from "./AnaliseLabMarkTools";
import type { InspectorViewMode } from "./analiseLabFit";
import type { InspectMeasureMode } from "./analiseLabInspectMeasure";
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
  /** Oculta réguas/grade/guias/offset (modo Folhear browse). */
  hideViewAids?: boolean;
  cropActive?: boolean;
  cropDisabled?: boolean;
  onToggleCrop?: () => void;
  measureMode?: InspectMeasureMode;
  onMeasureModeChange?: (mode: InspectMeasureMode) => void;
  selectedGuideIds?: string[];
  selectedGuideColor?: string | null;
  onSelectedGuideColorChange?: (color: string) => void;
  onDeleteSelectedGuides?: () => void;
  guideDistanceLabel?: string | null;
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
  hideViewAids = false,
  cropActive = false,
  cropDisabled = false,
  onToggleCrop,
  measureMode = "off",
  onMeasureModeChange,
  selectedGuideIds = [],
  selectedGuideColor = null,
  onSelectedGuideColorChange,
  onDeleteSelectedGuides,
  guideDistanceLabel = null,
}: AnaliseLabToolbarProps) {
  const hasGuides = prefs.guidesX.length > 0 || prefs.guidesY.length > 0;
  const showOptions = !hideMarkOptions && mark.tool !== "select";
  const hasSelection = selectedGuideIds.length > 0;
  const singleSelection = selectedGuideIds.length === 1;

  const {
    onToolChange,
    ...createOptions
  } = mark;

  const setMeasureMode = (mode: InspectMeasureMode) => {
    onMeasureModeChange?.(mode);
    if (mode !== "off") onToolChange("select");
  };

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
            {Math.round(zoom * 100)}%
          </span>
        </div>

        {!hideViewAids ? (
          <>
            <span className={divider} aria-hidden />

            <div className="flex flex-wrap items-center gap-1">
              <button
                type="button"
                onClick={() =>
                  onPrefsChange({ ...prefs, rulers: !prefs.rulers })
                }
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
                onClick={() =>
                  onPrefsChange({ ...prefs, guides: !prefs.guides })
                }
                className={prefs.guides ? btnActive : btnIdle}
                title="Linhas guia"
                aria-label="Linhas guia"
                aria-pressed={prefs.guides}
              >
                Guia
              </button>
              {prefs.guides ? (
                <>
                  <input
                    type="color"
                    value={prefs.guideColor}
                    onChange={(e) =>
                      onPrefsChange({ ...prefs, guideColor: e.target.value })
                    }
                    className={colorInputClass}
                    title="Cor das novas guias"
                    aria-label="Cor das novas guias"
                  />
                  {singleSelection && selectedGuideColor != null ? (
                    <input
                      type="color"
                      value={selectedGuideColor}
                      onChange={(e) =>
                        onSelectedGuideColorChange?.(e.target.value)
                      }
                      className={colorInputClass}
                      title="Cor da guia selecionada"
                      aria-label="Cor da guia selecionada"
                    />
                  ) : null}
                </>
              ) : null}
              {hasSelection ? (
                <button
                  type="button"
                  onClick={onDeleteSelectedGuides}
                  className={btnIdle}
                  title="Excluir guia selecionada"
                  aria-label="Excluir guia selecionada"
                >
                  <Trash2 className="size-3.5" aria-hidden />
                </button>
              ) : null}
              <button
                type="button"
                disabled={!hasGuides}
                onClick={() =>
                  onPrefsChange({ ...prefs, guidesX: [], guidesY: [] })
                }
                className={`${btnIdle} disabled:opacity-40`}
                title="Limpar guias"
              >
                Limpar
              </button>
              {guideDistanceLabel ? (
                <span className="rounded bg-sky-50 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-sky-800">
                  {guideDistanceLabel}
                </span>
              ) : null}

              <span className={divider} aria-hidden />

              <button
                type="button"
                onClick={() =>
                  setMeasureMode(measureMode === "area" ? "off" : "area")
                }
                className={measureMode === "area" ? btnActive : btnIdle}
                title="Medir área (retângulo)"
                aria-label="Medir área"
                aria-pressed={measureMode === "area"}
              >
                <Square className="size-3.5" aria-hidden />
                <span className="ml-1 hidden sm:inline">Área</span>
              </button>
              <button
                type="button"
                onClick={() =>
                  setMeasureMode(measureMode === "ruler" ? "off" : "ruler")
                }
                className={measureMode === "ruler" ? btnActive : btnIdle}
                title="Régua (distância entre 2 pontos)"
                aria-label="Régua"
                aria-pressed={measureMode === "ruler"}
              >
                <MoveDiagonal className="size-3.5" aria-hidden />
                <span className="ml-1 hidden sm:inline">Régua</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  onToggleCrop?.();
                  if (!cropActive) setMeasureMode("off");
                }}
                disabled={cropDisabled || !onToggleCrop}
                className={`${cropActive ? btnActive : btnIdle} disabled:opacity-40`}
                title="Recortar PDF de origem"
                aria-label="Crop"
                aria-pressed={cropActive}
              >
                <Crop className="size-3.5" aria-hidden />
                <span className="ml-1 hidden sm:inline">Crop</span>
              </button>

              <button
                type="button"
                onClick={() =>
                  onPrefsChange({ ...prefs, offset: !prefs.offset })
                }
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
          </>
        ) : null}

        {!hideViewAids ? (
          <span className="ml-auto tabular-nums text-[11px] font-semibold text-neutral-700">
            Pág. {sizeLabel}
          </span>
        ) : null}
      </div>

      {showOptions ? <AnaliseLabMarkCreateOptions {...createOptions} /> : null}
    </div>
  );
}
