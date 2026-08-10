import { Ruler, Trash2 } from "lucide-react";

import type {
  AnaliseLabEdge,
  AnaliseLabMark,
  AnaliseLabMarkCor,
  AnaliseLabMarkTipo,
} from "@/api/analiseLab";

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

const COLORS: AnaliseLabMarkCor[] = [
  "red",
  "orange",
  "yellow",
  "green",
  "blue",
  "purple",
  "black",
];

const EDGES: AnaliseLabEdge[] = ["top", "right", "bottom", "left"];

interface AnaliseLabMarkToolsProps {
  tool: AnaliseLabTool;
  onToolChange: (tool: AnaliseLabTool) => void;
  edge: AnaliseLabEdge;
  onEdgeChange: (edge: AnaliseLabEdge) => void;
  offsetMm: number;
  onOffsetMmChange: (v: number) => void;
  applyAllPages: boolean;
  onApplyAllPagesChange: (v: boolean) => void;
  cor: AnaliseLabMarkCor;
  onCorChange: (c: AnaliseLabMarkCor) => void;
  rotulo: string;
  onRotuloChange: (v: string) => void;
  stepMm: number;
  onStepMmChange: (v: number) => void;
  marks: AnaliseLabMark[];
  onDeleteMark: (id: number) => void;
  onAddOffset: () => void;
  onAddFaixa: () => void;
  onAddGrade: () => void;
  busy?: boolean;
}

export function AnaliseLabMarkTools({
  tool,
  onToolChange,
  edge,
  onEdgeChange,
  offsetMm,
  onOffsetMmChange,
  applyAllPages,
  onApplyAllPagesChange,
  cor,
  onCorChange,
  rotulo,
  onRotuloChange,
  stepMm,
  onStepMmChange,
  marks,
  onDeleteMark,
  onAddOffset,
  onAddFaixa,
  onAddGrade,
  busy = false,
}: AnaliseLabMarkToolsProps) {
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
          {COLORS.map((c) => (
            <option key={c} value={c}>
              {c}
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

      {(tool === "offset_corte" || tool === "faixa") && (
        <div className="space-y-2 rounded border border-sagra-border bg-neutral-50 p-2">
          <label className="flex flex-col gap-1 text-xs text-neutral-600">
            Borda
            <select
              value={edge}
              onChange={(e) => onEdgeChange(e.target.value as AnaliseLabEdge)}
              className="rounded border border-sagra-border px-2 py-1.5"
            >
              {EDGES.map((e) => (
                <option key={e} value={e}>
                  {e}
                </option>
              ))}
            </select>
          </label>
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
            disabled={busy}
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
            disabled={busy}
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
        </p>
      )}

      <div className="mt-2 border-t border-sagra-border pt-2">
        <h3 className="mb-1 text-xs font-semibold uppercase text-neutral-600">
          Marcas ({marks.length})
        </h3>
        <ul className="max-h-64 space-y-1 overflow-y-auto">
          {marks.map((m) => (
            <li
              key={m.id}
              className="flex items-center justify-between gap-2 rounded border border-sagra-border px-2 py-1 text-xs"
            >
              <span className="min-w-0 truncate">
                {m.tipo}
                {m.rotulo ? ` · ${m.rotulo}` : ""}
                {m.pagina === 0 ? " · todas" : ` · p${m.pagina}`}
              </span>
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
