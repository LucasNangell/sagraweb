import { Pencil, Ruler, Trash2 } from "lucide-react";
import { useMemo, type ReactNode } from "react";

import type {
  AnaliseLabEdge,
  AnaliseLabMark,
  AnaliseLabMarkCor,
  AnaliseLabMarkTipo,
} from "@/api/analiseLab";
import {
  COLOR_OPTIONS,
  EDGE_OPTIONS,
  labelCor,
  labelEdge,
  labelTipo,
} from "./analiseLabLabels";
import {
  markScopeLabel,
  parsePageSpec,
  validatePageSpec,
} from "./analiseLabPageSpec";

export type AnaliseLabTool =
  | "select"
  | "offset_corte"
  | "faixa"
  | "retangulo"
  | "ponto"
  | "medida"
  | "grade";

const TOOLS: Array<{ id: AnaliseLabTool; label: string }> = [
  { id: "select", label: "Selecionar" },
  { id: "offset_corte", label: "Offset de corte" },
  { id: "faixa", label: "Faixa" },
  { id: "retangulo", label: "Retângulo" },
  { id: "ponto", label: "Ponto" },
  { id: "medida", label: "Medir" },
  { id: "grade", label: "Grade" },
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
  marks: AnaliseLabMark[];
  selectedMarkId: number | null;
  onSelectMark: (id: number | null) => void;
  onDeleteMark: (id: number) => void;
  onAddOffset: () => void;
  onAddFaixa: () => void;
  onAddGrade: () => void;
  editorSlot?: ReactNode;
  busy?: boolean;
}

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
  marks,
  selectedMarkId,
  onSelectMark,
  onDeleteMark,
  onAddOffset,
  onAddFaixa,
  onAddGrade,
  editorSlot,
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
    (tool === "offset_corte" || tool === "faixa" || tool === "retangulo");

  const insertDisabled = busy || (!applyAllPages && Boolean(pageSpecError));

  return (
    <aside className="flex w-72 shrink-0 flex-col gap-3 overflow-y-auto border-l border-sagra-border bg-white p-3 text-sm">
      <h2 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-neutral-600">
        <Ruler className="size-3.5" aria-hidden />
        Ferramentas
      </h2>

      <div className="flex flex-wrap gap-1">
        {TOOLS.map((t) => (
          <button
            key={t.id}
            type="button"
            disabled={busy}
            onClick={() => onToolChange(t.id)}
            className={
              tool === t.id
                ? "rounded bg-primary-green px-2 py-1 text-xs font-medium text-white"
                : "rounded border border-sagra-border bg-white px-2 py-1 text-xs text-neutral-700 hover:bg-neutral-50"
            }
          >
            {t.label}
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
          className="rounded border border-sagra-border px-2 py-1.5"
          placeholder="opcional"
        />
      </label>

      <label className="flex items-center gap-2 text-xs text-neutral-700">
        <input
          type="checkbox"
          checked={applyAllPages}
          onChange={(e) => onApplyAllPagesChange(e.target.checked)}
        />
        Aplicar a todas as páginas
      </label>

      {!applyAllPages ? (
        <label className="flex flex-col gap-1 text-xs text-neutral-600">
          Páginas
          <input
            value={pageSpec}
            onChange={(e) => onPageSpecChange(e.target.value)}
            className={
              pageSpecError
                ? "rounded border border-sagra-danger px-2 py-1.5"
                : "rounded border border-sagra-border px-2 py-1.5"
            }
            placeholder="1-15,20,23,25-30"
          />
          {pageSpecError ? (
            <span className="text-[11px] text-sagra-danger">{pageSpecError}</span>
          ) : (
            <span className="text-[11px] text-neutral-400">
              Use vírgulas e hífens (ex.: 1-15,20,23).
            </span>
          )}
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
                Arraste na régua da página para criar a faixa, ou informe De/Até
                abaixo.
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
            className="w-full rounded bg-secondary-blue px-2 py-1.5 text-xs font-semibold text-white hover:bg-secondary-blue/90 disabled:opacity-50"
          >
            Inserir marca
          </button>
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
              step={1}
              value={stepMm}
              onChange={(e) => onStepMmChange(Number(e.target.value) || 10)}
              className="rounded border border-sagra-border px-2 py-1.5"
            />
          </label>
          <button
            type="button"
            disabled={insertDisabled}
            onClick={onAddGrade}
            className="w-full rounded bg-secondary-blue px-2 py-1.5 text-xs font-semibold text-white hover:bg-secondary-blue/90 disabled:opacity-50"
          >
            Inserir grade
          </button>
        </div>
      )}

      {(tool === "retangulo" || tool === "ponto" || tool === "medida") && (
        <p className="text-xs text-neutral-500">
          Clique na página de inspeção para posicionar a marca
          {tool === "medida" || tool === "retangulo"
            ? " (dois cliques)."
            : "."}
          {!applyAllPages && pageSpecError
            ? " Corrija o campo Páginas antes de gravar."
            : ""}
        </p>
      )}

      {editorSlot}

      <div className="mt-2 border-t border-sagra-border pt-2">
        <h3 className="mb-1 text-xs font-semibold uppercase text-neutral-600">
          Marcas ({marks.length})
        </h3>
        <ul className="max-h-64 space-y-1 overflow-y-auto">
          {marks.map((m) => (
            <li
              key={m.id}
              className={
                selectedMarkId === m.id
                  ? "flex items-center justify-between gap-2 rounded border border-primary-green bg-primary-green/5 px-2 py-1 text-xs"
                  : "flex items-center justify-between gap-2 rounded border border-sagra-border px-2 py-1 text-xs"
              }
            >
              <button
                type="button"
                className="min-w-0 flex-1 truncate text-left"
                onClick={() =>
                  onSelectMark(selectedMarkId === m.id ? null : m.id)
                }
                title="Editar"
              >
                <Pencil className="mr-1 inline size-3 opacity-60" aria-hidden />
                {labelTipo(m.tipo)}
                {m.rotulo ? ` · ${m.rotulo}` : ""}
                {` · ${markScopeLabel(m)}`}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => onDeleteMark(m.id)}
                className="shrink-0 text-sagra-danger hover:opacity-80"
                title="Excluir"
              >
                <Trash2 className="size-3.5" aria-hidden />
              </button>
            </li>
          ))}
          {!marks.length ? (
            <li className="text-xs text-neutral-400">Nenhuma marca ainda.</li>
          ) : null}
        </ul>
      </div>
    </aside>
  );
}

export function toolToTipo(tool: AnaliseLabTool): AnaliseLabMarkTipo | null {
  if (tool === "select") return null;
  return tool;
}
