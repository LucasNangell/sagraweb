import {
  ArrowUpRight,
  Circle,
  Droplets,
  Grid3X3,
  MousePointer2,
  Pencil,
  Ruler,
  Square,
  Type,
} from "lucide-react";
import { useMemo, type ReactNode } from "react";

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

export type AnaliseLabTool =
  | "select"
  | "offset_corte"
  | "faixa"
  | "sangria"
  | "retangulo"
  | "ponto"
  | "medida"
  | "grade"
  | "seta"
  | "circulo"
  | "texto"
  | "livre";

const TOOLS: Array<{ id: AnaliseLabTool; label: string; icon: ReactNode }> = [
  { id: "select", label: "Selecionar", icon: <MousePointer2 className="size-3.5" /> },
  { id: "offset_corte", label: "Offset", icon: <Ruler className="size-3.5" /> },
  { id: "faixa", label: "Faixa", icon: <Square className="size-3.5" /> },
  { id: "sangria", label: "Sangria", icon: <Droplets className="size-3.5" /> },
  { id: "retangulo", label: "Retângulo", icon: <Square className="size-3.5" /> },
  { id: "circulo", label: "Círculo", icon: <Circle className="size-3.5" /> },
  { id: "seta", label: "Seta", icon: <ArrowUpRight className="size-3.5" /> },
  { id: "ponto", label: "Ponto", icon: <Circle className="size-3.5" /> },
  { id: "medida", label: "Medir", icon: <Ruler className="size-3.5" /> },
  { id: "texto", label: "Texto", icon: <Type className="size-3.5" /> },
  { id: "livre", label: "Livre", icon: <Pencil className="size-3.5" /> },
  { id: "grade", label: "Grade", icon: <Grid3X3 className="size-3.5" /> },
];

interface AnaliseLabMarkToolsProps {
  tool: AnaliseLabTool;
  onToolChange: (tool: AnaliseLabTool) => void;
  edge: AnaliseLabEdge;
  onEdgeChange: (edge: AnaliseLabEdge) => void;
  offsetMm: number;
  onOffsetMmChange: (v: number) => void;
  fromMm: number;
  onFromMmChange: (v: number) => void;
  applyAllPages: boolean;
  onApplyAllPagesChange: (v: boolean) => void;
  pageSpec: string;
  onPageSpecChange: (v: string) => void;
  espelhar: boolean;
  onEspelharChange: (v: boolean) => void;
  cor: AnaliseLabMarkCor;
  onCorChange: (c: AnaliseLabMarkCor) => void;
  rotulo: string;
  onRotuloChange: (v: string) => void;
  stepMm: number;
  onStepMmChange: (v: number) => void;
  espessura: number;
  onEspessuraChange: (v: number) => void;
  onAddOffset: () => void;
  onAddFaixa: () => void;
  onAddGrade: () => void;
  busy?: boolean;
}

/** Controles da paleta (sem aside / lista). */
export function AnaliseLabMarkTools({
  tool,
  onToolChange,
  edge,
  onEdgeChange,
  offsetMm,
  onOffsetMmChange,
  fromMm,
  onFromMmChange,
  applyAllPages,
  onApplyAllPagesChange,
  pageSpec,
  onPageSpecChange,
  espelhar,
  onEspelharChange,
  cor,
  onCorChange,
  rotulo,
  onRotuloChange,
  stepMm,
  onStepMmChange,
  espessura,
  onEspessuraChange,
  onAddOffset,
  onAddFaixa,
  onAddGrade,
  busy = false,
}: AnaliseLabMarkToolsProps) {
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
  const sangriaEdge =
    edge === "all" ? "left" : (edge as AnaliseLabEdge);

  return (
    <div className="flex flex-col gap-2 text-sm">
      <div className="flex flex-wrap gap-1">
        {TOOLS.map((t) => (
          <button
            key={t.id}
            type="button"
            disabled={busy}
            title={t.label}
            onClick={() => onToolChange(t.id)}
            className={
              tool === t.id
                ? "inline-flex items-center gap-1 rounded bg-primary-green px-1.5 py-1 text-[10px] font-medium text-white"
                : "inline-flex items-center gap-1 rounded border border-sagra-border bg-white px-1.5 py-1 text-[10px] text-neutral-700 hover:bg-neutral-50"
            }
          >
            {t.icon}
            <span className="hidden sm:inline">{t.label}</span>
          </button>
        ))}
      </div>

      <label className="flex flex-col gap-1 text-xs text-neutral-600">
        Cor
        <select
          value={cor}
          onChange={(e) => onCorChange(e.target.value as AnaliseLabMarkCor)}
          className="rounded border border-sagra-border px-2 py-1.5"
        >
          {COLOR_OPTIONS.map((c) => (
            <option key={c} value={c}>
              {labelCor(c)}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-xs text-neutral-600">
        Rótulo
        <input
          value={rotulo}
          onChange={(e) => onRotuloChange(e.target.value)}
          maxLength={120}
          placeholder="Opcional"
          className="rounded border border-sagra-border px-2 py-1.5"
        />
      </label>

      {showStroke ? (
        <label className="flex flex-col gap-1 text-xs text-neutral-600">
          Espessura
          <select
            value={espessura}
            onChange={(e) => onEspessuraChange(Number(e.target.value) || 2)}
            className="rounded border border-sagra-border px-2 py-1.5"
          >
            <option value={1}>Fina</option>
            <option value={2}>Média</option>
            <option value={3}>Grossa</option>
          </select>
        </label>
      ) : null}

      <label className="flex items-center gap-2 text-xs text-neutral-700">
        <input
          type="checkbox"
          checked={applyAllPages}
          onChange={(e) => onApplyAllPagesChange(e.target.checked)}
        />
        Todas as páginas
      </label>

      {!applyAllPages ? (
        <label className="flex flex-col gap-1 text-xs text-neutral-600">
          Páginas
          <input
            value={pageSpec}
            onChange={(e) => onPageSpecChange(e.target.value)}
            placeholder="1-15,20,23"
            className="rounded border border-sagra-border px-2 py-1.5"
          />
          {pageSpecError ? (
            <span className="text-[11px] text-sagra-danger">{pageSpecError}</span>
          ) : null}
        </label>
      ) : null}

      {showMirror ? (
        <label className="flex items-center gap-2 text-xs text-neutral-700">
          <input
            type="checkbox"
            checked={espelhar}
            onChange={(e) => onEspelharChange(e.target.checked)}
          />
          Espelhar em páginas opostas
        </label>
      ) : null}

      {(tool === "offset_corte" || tool === "faixa") && (
        <div className="space-y-2 rounded border border-sagra-border bg-neutral-50 p-2">
          <label className="flex flex-col gap-1 text-xs text-neutral-600">
            Borda
            <select
              value={edge}
              onChange={(e) => onEdgeChange(e.target.value as AnaliseLabEdge)}
              className="rounded border border-sagra-border px-2 py-1.5"
            >
              {EDGE_OPTIONS.map((e) => (
                <option key={e} value={e}>
                  {labelEdge(e)}
                </option>
              ))}
            </select>
          </label>
          {tool === "faixa" ? (
            <>
              <p className="text-[11px] text-neutral-500">
                Arraste na régua ou informe De/Até.
              </p>
              <label className="flex flex-col gap-1 text-xs text-neutral-600">
                De (mm)
                <input
                  type="number"
                  min={0}
                  step={0.5}
                  value={fromMm}
                  onChange={(e) => onFromMmChange(Number(e.target.value) || 0)}
                  className="rounded border border-sagra-border px-2 py-1.5"
                />
              </label>
            </>
          ) : null}
          <label className="flex flex-col gap-1 text-xs text-neutral-600">
            {tool === "offset_corte" ? "Offset (mm)" : "Até (mm)"}
            <input
              type="number"
              min={0}
              step={0.5}
              value={offsetMm}
              onChange={(e) => onOffsetMmChange(Number(e.target.value) || 0)}
              className="rounded border border-sagra-border px-2 py-1.5"
            />
          </label>
          <button
            type="button"
            disabled={insertDisabled}
            onClick={tool === "offset_corte" ? onAddOffset : onAddFaixa}
            className="w-full rounded bg-secondary-blue px-2 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
          >
            Inserir marca
          </button>
        </div>
      )}

      {tool === "sangria" && (
        <div className="space-y-2 rounded border border-sagra-border bg-neutral-50 p-2">
          <label className="flex flex-col gap-1 text-xs text-neutral-600">
            Borda
            <select
              value={sangriaEdge}
              onChange={(e) => onEdgeChange(e.target.value as AnaliseLabEdge)}
              className="rounded border border-sagra-border px-2 py-1.5"
            >
              {EDGE_OPTIONS_SANGRIA.map((e) => (
                <option key={e} value={e}>
                  {labelEdge(e)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-neutral-600">
            Profundidade (mm)
            <input
              type="number"
              min={0.5}
              max={50}
              step={0.5}
              value={offsetMm}
              onChange={(e) => onOffsetMmChange(Number(e.target.value) || 5)}
              className="rounded border border-sagra-border px-2 py-1.5"
            />
          </label>
          <p className="text-[11px] text-neutral-500">
            Arraste na página ao longo da borda para marcar o trecho (fora do
            papel: −{offsetMm || 5}→0 mm).
          </p>
        </div>
      )}

      {tool === "grade" && (
        <div className="space-y-2 rounded border border-sagra-border bg-neutral-50 p-2">
          <label className="flex flex-col gap-1 text-xs text-neutral-600">
            Passo (mm)
            <input
              type="number"
              min={1}
              max={50}
              value={stepMm}
              onChange={(e) => onStepMmChange(Number(e.target.value) || 10)}
              className="rounded border border-sagra-border px-2 py-1.5"
            />
          </label>
          <button
            type="button"
            disabled={insertDisabled}
            onClick={onAddGrade}
            className="w-full rounded bg-secondary-blue px-2 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
          >
            Inserir grade
          </button>
        </div>
      )}

      {(tool === "retangulo" ||
        tool === "ponto" ||
        tool === "medida" ||
        tool === "seta" ||
        tool === "circulo") && (
        <p className="text-xs text-neutral-500">
          Clique na página para posicionar
          {tool === "medida" ||
          tool === "retangulo" ||
          tool === "seta" ||
          tool === "circulo"
            ? " (dois cliques)."
            : "."}
        </p>
      )}
      {tool === "texto" ? (
        <p className="text-xs text-neutral-500">
          Clique na página e digite o texto (Enter para gravar).
        </p>
      ) : null}
      {tool === "livre" ? (
        <p className="text-xs text-neutral-500">
          Arraste na página para desenhar o traço livre.
        </p>
      ) : null}
    </div>
  );
}

export function toolToTipo(tool: AnaliseLabTool): AnaliseLabMarkTipoOrNull {
  if (tool === "select") return null;
  return tool;
}

type AnaliseLabMarkTipoOrNull =
  | "offset_corte"
  | "faixa"
  | "sangria"
  | "retangulo"
  | "ponto"
  | "medida"
  | "grade"
  | "seta"
  | "circulo"
  | "texto"
  | "livre"
  | null;
