import { ChevronDown, ChevronUp, Plus, Trash2 } from "lucide-react";

import type {
  BoxModelConfig,
  BoxModelHinge,
  BoxModelOperation,
} from "@/api/boxModels";
import {
  buildParentMapFromBase,
  movingPanelForHinge,
} from "@/features/prova-web/box-engine/boxPanelTree";

function panelLabel(config: BoxModelConfig, panelId: string): string {
  const p = config.panels.find((x) => x.id === panelId);
  return (p?.label && p.label.trim()) || panelId;
}

function makeOp(
  config: BoxModelConfig,
  hinge: BoxModelHinge,
  order?: number,
): BoxModelOperation {
  const maxOrder = Math.max(0, ...config.operations.map((o) => o.order));
  const parentMap = buildParentMapFromBase(
    config.basePanelId,
    config.hinges ?? [],
  );
  return {
    id: `op_${hinge.id}_${Date.now().toString(36)}`,
    hingeId: hinge.id,
    panelId: movingPanelForHinge(hinge, parentMap, config.basePanelId),
    order: order ?? maxOrder + 1,
    movingSide: "positive",
    towards: "front",
    targetAngleDeg: 90,
  };
}

/** Níveis distintos de order, ordenados. */
function distinctOrders(ops: BoxModelOperation[]): number[] {
  return [...new Set(ops.map((o) => o.order))].sort((a, b) => a - b);
}

export interface BoxModelOperationsListProps {
  config: BoxModelConfig;
  selectedHingeId: string | null;
  onSelectHinge: (hingeId: string) => void;
  onChange: (next: BoxModelConfig) => void;
}

/** Lista só das dobras já adicionadas (começa vazia). */
export function BoxModelOperationsList({
  config,
  selectedHingeId,
  onSelectHinge,
  onChange,
}: BoxModelOperationsListProps) {
  const hingeById = new Map(config.hinges.map((h) => [h.id, h]));
  const rows = [...config.operations].sort((a, b) => {
    if (a.order !== b.order) return a.order - b.order;
    return a.id.localeCompare(b.id);
  });
  const levels = distinctOrders(config.operations);

  const patchOp = (opId: string, patch: Partial<BoxModelOperation>) => {
    onChange({
      ...config,
      operations: config.operations.map((o) =>
        o.id === opId ? { ...o, ...patch } : o,
      ),
    });
  };

  const removeOp = (opId: string) => {
    // Não renumerar — preserva grupos no mesmo passo
    onChange({
      ...config,
      operations: config.operations.filter((o) => o.id !== opId),
    });
  };

  /** Move a dobra para o nível de ordem vizinho (mantém grupos). */
  const moveLevel = (opId: string, dir: -1 | 1) => {
    const op = config.operations.find((o) => o.id === opId);
    if (!op) return;
    const i = levels.indexOf(op.order);
    if (i < 0) return;
    if (dir < 0 && i === 0) {
      // Cria passo anterior
      const newOrder = op.order - 1;
      onChange({
        ...config,
        operations: config.operations.map((o) =>
          o.id === opId ? { ...o, order: newOrder } : o,
        ),
      });
      return;
    }
    if (dir > 0 && i === levels.length - 1) {
      const newOrder = op.order + 1;
      onChange({
        ...config,
        operations: config.operations.map((o) =>
          o.id === opId ? { ...o, order: newOrder } : o,
        ),
      });
      return;
    }
    const targetOrder = levels[i + dir];
    if (targetOrder == null) return;
    onChange({
      ...config,
      operations: config.operations.map((o) =>
        o.id === opId ? { ...o, order: targetOrder } : o,
      ),
    });
  };

  const renumber = () => {
    const sorted = [...config.operations].sort((a, b) => a.order - b.order);
    onChange({
      ...config,
      operations: sorted.map((o, i) => ({ ...o, order: i + 1 })),
    });
  };

  let lastOrder: number | null = null;

  return (
    <div className="flex min-h-0 flex-col rounded-lg border border-slate-200 bg-white">
      <div className="border-b border-slate-100 px-3 py-2">
        <p className="text-xs font-semibold text-slate-800">
          Sequência de dobras ({rows.length}
          {levels.length !== rows.length ? ` · ${levels.length} passos` : ""})
        </p>
        <p className="mt-0.5 text-[11px] text-slate-500">
          Mesmo número de passo = dobram juntas. Ângulo +/− define o sentido.
        </p>
        {rows.length > 0 ? (
          <button
            type="button"
            className="mt-2 rounded border border-slate-200 px-2 py-1 text-[11px] text-slate-700 hover:bg-slate-50"
            onClick={renumber}
            title="Força um passo por dobra (1…N)"
          >
            Renumerar 1…N (únicos)
          </button>
        ) : null}
      </div>

      <ul className="max-h-[min(560px,65vh)] space-y-2 overflow-auto p-2">
        {rows.length === 0 ? (
          <li className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-8 text-center text-xs text-slate-500">
            Nenhuma dobra na sequência ainda.
            <br />
            Selecione um vinco (linha tracejada teal) e clique em{" "}
            <span className="font-medium text-slate-700">
              Adicionar à sequência
            </span>
            .
          </li>
        ) : null}

        {rows.map((op) => {
          const hinge = hingeById.get(op.hingeId);
          const selected = op.hingeId === selectedHingeId;
          const showStepHeader = op.order !== lastOrder;
          lastOrder = op.order;
          const peers = rows.filter((r) => r.order === op.order).length;
          return (
            <li key={op.id}>
              {showStepHeader ? (
                <p className="mb-1 px-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                  Passo {op.order}
                  {peers > 1 ? ` · ${peers} dobras` : ""}
                </p>
              ) : null}
              <div
                className={`rounded-lg border px-2.5 py-2 transition ${
                  selected
                    ? "border-amber-400 bg-amber-50 ring-1 ring-amber-300"
                    : "border-slate-200 bg-slate-50"
                }`}
              >
                <div className="flex items-start gap-2">
                  <button
                    type="button"
                    className="mt-0.5 rounded bg-teal-700 px-1.5 py-0.5 text-[11px] font-bold text-white"
                    onClick={() => onSelectHinge(op.hingeId)}
                  >
                    {op.order}
                  </button>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium text-slate-800">
                      {panelLabel(config, op.panelId)}
                    </p>
                    <p className="text-[10px] text-slate-500">
                      {hinge
                        ? `${hinge.axis} @ ${hinge.positionMm.toFixed(0)} mm`
                        : op.hingeId}
                    </p>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <button
                      type="button"
                      className="rounded border border-slate-200 bg-white p-0.5 text-slate-600 hover:bg-slate-100"
                      aria-label="Passo anterior"
                      onClick={() => moveLevel(op.id, -1)}
                    >
                      <ChevronUp className="size-3.5" aria-hidden />
                    </button>
                    <button
                      type="button"
                      className="rounded border border-slate-200 bg-white p-0.5 text-slate-600 hover:bg-slate-100"
                      aria-label="Próximo passo"
                      onClick={() => moveLevel(op.id, 1)}
                    >
                      <ChevronDown className="size-3.5" aria-hidden />
                    </button>
                  </div>
                </div>

                <div className="mt-2 grid grid-cols-2 gap-2">
                  <label className="text-[10px] text-slate-600">
                    Passo
                    <input
                      type="number"
                      min={1}
                      className="mt-0.5 w-full rounded border border-slate-200 px-1.5 py-1 text-xs"
                      value={op.order}
                      onChange={(e) =>
                        patchOp(op.id, {
                          order: Math.max(1, Number(e.target.value) || 1),
                        })
                      }
                    />
                  </label>
                  <label className="text-[10px] text-slate-600">
                    Ângulo (°)
                    <input
                      type="number"
                      min={-180}
                      max={180}
                      step={5}
                      className="mt-0.5 w-full rounded border border-slate-200 px-1.5 py-1 text-xs"
                      value={op.targetAngleDeg}
                      onChange={(e) =>
                        patchOp(op.id, {
                          targetAngleDeg: Number(e.target.value) || 0,
                        })
                      }
                    />
                  </label>
                </div>

                <div className="mt-2 flex flex-wrap gap-1">
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-2 py-1 text-[10px] text-slate-700 hover:bg-slate-100"
                    onClick={() => removeOp(op.id)}
                  >
                    <Trash2 className="size-3" aria-hidden />
                    Remover
                  </button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function addHingeToSequence(
  config: BoxModelConfig,
  hingeId: string,
  opts?: { sameStepAs?: number | null },
): BoxModelConfig {
  if (config.operations.some((o) => o.hingeId === hingeId)) return config;
  const hinge = config.hinges.find((h) => h.id === hingeId);
  if (!hinge || hinge.active === false || hinge.kind === "cut") return config;
  const order =
    opts?.sameStepAs != null && opts.sameStepAs > 0
      ? opts.sameStepAs
      : undefined;
  return {
    ...config,
    operations: [...config.operations, makeOp(config, hinge, order)],
  };
}

export function setEdgeKind(
  config: BoxModelConfig,
  edgeId: string,
  kind: "cut" | "fold",
): BoxModelConfig {
  const edges = (config.edges ?? []).map((e) =>
    e.id === edgeId ? { ...e, kind } : e,
  );
  const edge = edges.find((e) => e.id === edgeId);
  let hinges = config.hinges;
  let operations = config.operations;
  if (edge?.hingeId) {
    hinges = config.hinges.map((h) =>
      h.id === edge.hingeId
        ? { ...h, kind, active: kind === "fold" }
        : h,
    );
    if (kind === "cut") {
      operations = config.operations.filter((o) => o.hingeId !== edge.hingeId);
    }
  }
  const foldSegmentsMm = edges
    .filter((e) => e.kind === "fold")
    .map((e) => ({ x1: e.x1, y1: e.y1, x2: e.x2, y2: e.y2 }));
  const cutSegmentsMm = edges
    .filter((e) => e.kind === "cut")
    .map((e) => ({ x1: e.x1, y1: e.y1, x2: e.x2, y2: e.y2 }));
  return {
    ...config,
    edges,
    hinges,
    operations,
    foldSegmentsMm,
    cutSegmentsMm,
  };
}

/** Botão auxiliar — exportado para a seção de propriedades. */
export function AddToSequenceHint() {
  return (
    <p className="inline-flex items-center gap-1 text-[11px] text-slate-600">
      <Plus className="size-3" aria-hidden />
      Adicionar à sequência
    </p>
  );
}
