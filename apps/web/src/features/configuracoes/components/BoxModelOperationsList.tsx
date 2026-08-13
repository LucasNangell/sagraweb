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
): BoxModelOperation {
  const maxOrder = Math.max(0, ...config.operations.map((o) => o.order));
  const parentMap = buildParentMapFromBase(
    config.basePanelId,
    config.hinges ?? [],
  );
  return {
    id: `op_${hinge.id}_${maxOrder + 1}`,
    hingeId: hinge.id,
    panelId: movingPanelForHinge(hinge, parentMap, config.basePanelId),
    order: maxOrder + 1,
    movingSide: "positive",
    towards: "front",
    targetAngleDeg: 90,
  };
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
  const rows = [...config.operations].sort((a, b) => a.order - b.order);

  const patchOp = (opId: string, patch: Partial<BoxModelOperation>) => {
    onChange({
      ...config,
      operations: config.operations.map((o) =>
        o.id === opId ? { ...o, ...patch } : o,
      ),
    });
  };

  const removeOp = (opId: string) => {
    const next = config.operations
      .filter((o) => o.id !== opId)
      .sort((a, b) => a.order - b.order)
      .map((o, i) => ({ ...o, order: i + 1 }));
    onChange({ ...config, operations: next });
  };

  const swapOrder = (opId: string, dir: -1 | 1) => {
    const sorted = [...config.operations].sort((a, b) => a.order - b.order);
    const i = sorted.findIndex((o) => o.id === opId);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= sorted.length) return;
    const a = sorted[i]!;
    const b = sorted[j]!;
    const orderA = a.order;
    onChange({
      ...config,
      operations: config.operations.map((o) => {
        if (o.id === a.id) return { ...o, order: b.order };
        if (o.id === b.id) return { ...o, order: orderA };
        return o;
      }),
    });
  };

  const renumber = () => {
    const sorted = [...config.operations].sort((a, b) => a.order - b.order);
    onChange({
      ...config,
      operations: sorted.map((o, i) => ({ ...o, order: i + 1 })),
    });
  };

  return (
    <div className="flex min-h-0 flex-col rounded-lg border border-slate-200 bg-white">
      <div className="border-b border-slate-100 px-3 py-2">
        <p className="text-xs font-semibold text-slate-800">
          Sequência de dobras ({rows.length})
        </p>
        <p className="mt-0.5 text-[11px] text-slate-500">
        Clique nas dobras (ciano). Ângulo +/− define o sentido. Sem operação =
        painel fica plano no preview.
        </p>
        {rows.length > 0 ? (
          <button
            type="button"
            className="mt-2 rounded border border-slate-200 px-2 py-1 text-[11px] text-slate-700 hover:bg-slate-50"
            onClick={renumber}
          >
            Renumerar 1…N
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
          return (
            <li key={op.id}>
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
                    className="min-w-0 flex-1 text-left"
                    onClick={() => onSelectHinge(op.hingeId)}
                  >
                    <p className="text-[11px] font-semibold text-slate-800">
                      #{op.order} · {panelLabel(config, op.panelId)}
                    </p>
                    <p className="truncate text-[10px] text-slate-500">
                      {hinge
                        ? `${hinge.axis} · ${panelLabel(config, hinge.panelA)} ↔ ${panelLabel(config, hinge.panelB)}`
                        : op.hingeId}
                    </p>
                    {!selected ? (
                      <p className="mt-1 text-[10px] text-slate-500">
                        {op.targetAngleDeg}°
                        {op.targetAngleDeg < 0
                          ? " (sentido −)"
                          : op.targetAngleDeg > 0
                            ? " (sentido +)"
                            : ""}
                      </p>
                    ) : null}
                  </button>
                  <div className="flex shrink-0 flex-col gap-0.5">
                    <button
                      type="button"
                      className="rounded border border-slate-200 bg-white p-0.5 text-slate-600 hover:bg-slate-100"
                      title="Subir"
                      onClick={() => swapOrder(op.id, -1)}
                    >
                      <ChevronUp className="size-3.5" aria-hidden />
                    </button>
                    <button
                      type="button"
                      className="rounded border border-slate-200 bg-white p-0.5 text-slate-600 hover:bg-slate-100"
                      title="Descer"
                      onClick={() => swapOrder(op.id, 1)}
                    >
                      <ChevronDown className="size-3.5" aria-hidden />
                    </button>
                  </div>
                </div>

                {selected && hinge ? (
                  <div className="mt-2 grid gap-2 border-t border-amber-200/80 pt-2 sm:grid-cols-2">
                    <label className="block text-[10px] font-medium text-slate-600">
                      Ordem
                      <input
                        type="number"
                        min={1}
                        className="mt-0.5 w-full rounded border border-slate-200 bg-white px-1.5 py-1 text-xs"
                        value={op.order}
                        onChange={(e) =>
                          patchOp(op.id, {
                            order: Math.max(1, Number(e.target.value) || 1),
                          })
                        }
                      />
                    </label>
                    <label className="block text-[10px] font-medium text-slate-600">
                      Ângulo (°)
                      <span className="mt-0.5 block font-normal text-slate-500">
                        + e − dobram para lados opostos
                      </span>
                      <input
                        type="number"
                        min={-180}
                        max={180}
                        className="mt-0.5 w-full rounded border border-slate-200 bg-white px-1.5 py-1 text-xs"
                        value={op.targetAngleDeg}
                        onChange={(e) =>
                          patchOp(op.id, {
                            targetAngleDeg: Math.min(
                              180,
                              Math.max(-180, Number(e.target.value) || 0),
                            ),
                          })
                        }
                      />
                    </label>
                    <div className="flex flex-wrap gap-1 sm:col-span-2">
                      {([-90, -45, 45, 90] as const).map((a) => (
                        <button
                          key={a}
                          type="button"
                          className="rounded border border-slate-200 bg-white px-2 py-0.5 text-[10px] text-slate-700 hover:bg-slate-100"
                          onClick={() => patchOp(op.id, { targetAngleDeg: a })}
                        >
                          {a > 0 ? `+${a}°` : `${a}°`}
                        </button>
                      ))}
                    </div>
                    <label className="block text-[10px] font-medium text-slate-600 sm:col-span-2">
                      Painel que dobra
                      <select
                        className="mt-0.5 w-full rounded border border-slate-200 bg-white px-1.5 py-1 text-xs"
                        value={op.panelId}
                        onChange={(e) =>
                          patchOp(op.id, { panelId: e.target.value })
                        }
                      >
                        <option value={hinge.panelA}>
                          {panelLabel(config, hinge.panelA)}
                        </option>
                        <option value={hinge.panelB}>
                          {panelLabel(config, hinge.panelB)}
                        </option>
                      </select>
                    </label>
                    <button
                      type="button"
                      className="inline-flex items-center justify-center gap-1 rounded border border-red-200 bg-white px-2 py-1 text-[11px] text-red-700 hover:bg-red-50 sm:col-span-2"
                      onClick={() => removeOp(op.id)}
                    >
                      <Trash2 className="size-3" aria-hidden />
                      Remover da sequência
                    </button>
                  </div>
                ) : null}
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
): BoxModelConfig {
  if (config.operations.some((o) => o.hingeId === hingeId)) return config;
  const hinge = config.hinges.find((h) => h.id === hingeId);
  if (!hinge || hinge.active === false || hinge.kind === "cut") return config;
  return {
    ...config,
    operations: [...config.operations, makeOp(config, hinge)],
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
      operations = config.operations
        .filter((o) => o.hingeId !== edge.hingeId)
        .sort((a, b) => a.order - b.order)
        .map((o, i) => ({ ...o, order: i + 1 }));
    }
  }
  // Atualiza segments de preview
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
