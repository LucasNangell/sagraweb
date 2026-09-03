import { Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";

import type {
  FoldCrease,
  FoldModelConfig,
  FoldMovingSide,
  FoldOperation,
  FoldPresetId,
  FoldTowards,
} from "@/api/provaWeb";
import { emptyCropSides } from "@/api/provaWeb";

import {
  buildFoldTopology,
  resolveMovingPanels,
  syncOperationsToBasePanel,
} from "./fold-engine";
import { FoldSchemaPreview } from "./FoldSchemaPreview";
import {
  applyFoldModelConfig,
  applyPresetToFolheto,
  defaultFolhetoCrop,
  FOLD_LINE_COLORS,
  FOLD_PRESET_OPTIONS,
  packFoldModelConfig,
  sheetFromPreset,
  toSheetDefinition,
} from "./provaWebFoldPresets";

export type BookExtraFoldDraft = {
  creases: FoldCrease[];
  operations: FoldOperation[];
  basePanelId: string | null;
  preset: FoldPresetId;
};

export function emptyBookExtraFoldDraft(
  widthMm: number,
  heightMm: number,
  preset: FoldPresetId = "biparte_vertical",
): BookExtraFoldDraft {
  if (preset === "personalizada") {
    return {
      creases: [],
      operations: [],
      basePanelId: null,
      preset: "personalizada",
    };
  }
  const { creases, operations } = sheetFromPreset(preset, widthMm, heightMm);
  return { creases, operations, basePanelId: null, preset };
}

export function draftFromFoldConfig(
  config: FoldModelConfig | null | undefined,
  widthMm: number,
  heightMm: number,
): BookExtraFoldDraft {
  if (!config) return emptyBookExtraFoldDraft(widthMm, heightMm);
  const base = defaultFolhetoCrop(widthMm, heightMm);
  const applied = applyFoldModelConfig(base, config, widthMm, heightMm);
  return {
    creases: applied.creases,
    operations: applied.operations,
    basePanelId: applied.basePanelId ?? null,
    preset: "personalizada",
  };
}

export function packBookExtraFoldDraft(
  draft: BookExtraFoldDraft,
  widthMm: number,
  heightMm: number,
): FoldModelConfig | null {
  if (!draft.creases.length || !draft.operations.length) return null;
  return packFoldModelConfig(
    {
      creases: draft.creases,
      operations: draft.operations,
      pageFrente: 0,
      pageVerso: null,
      basePanelId: draft.basePanelId,
    },
    widthMm,
    heightMm,
  );
}

interface BookExtraFoldEditorProps {
  widthMm: number;
  heightMm: number;
  value: BookExtraFoldDraft;
  onChange: (value: BookExtraFoldDraft) => void;
  ano?: number;
  osId?: number;
  pdfPath?: string | null;
}

export function BookExtraFoldEditor({
  widthMm,
  heightMm,
  value,
  onChange,
  ano = 0,
  osId = 0,
  pdfPath = null,
}: BookExtraFoldEditorProps) {
  const [selectedOpId, setSelectedOpId] = useState<string | null>(null);
  const w = Math.max(15, widthMm);
  const h = Math.max(15, heightMm);

  const folheto = useMemo(
    () => ({
      ...defaultFolhetoCrop(w, h),
      preset: value.preset,
      creases: value.creases,
      operations: value.operations,
      basePanelId: value.basePanelId,
      crop: emptyCropSides("manual"),
      pageFrente: 0,
      pageVerso: null as number | null,
    }),
    [value, w, h],
  );

  const topology = useMemo(() => {
    if (!value.creases.length) {
      return buildFoldTopology({
        widthMm: w,
        heightMm: h,
        thicknessMm: 0.22,
        creases: [],
        operations: [],
        backArtworkTransform: { mirrorX: false, mirrorY: false, rotationDeg: 0 },
        physical: {
          paperThicknessMm: 0.22,
          renderGapMm: 0.015,
          creaseRadiusMm: 0.35,
        },
      });
    }
    return buildFoldTopology(toSheetDefinition(folheto, w, h));
  }, [folheto, value.creases.length, w, h]);

  const selectedOp =
    value.operations.find((o) => o.id === selectedOpId) ??
    value.operations[0] ??
    null;
  const movingIds = useMemo(() => {
    if (!selectedOp || !value.creases.length) return new Set<string>();
    try {
      return resolveMovingPanels(topology, selectedOp, value.creases);
    } catch {
      return new Set<string>();
    }
  }, [selectedOp, topology, value.creases]);

  const setDraft = (patch: Partial<BookExtraFoldDraft>) => {
    onChange({ ...value, ...patch });
  };

  const selectPreset = (preset: FoldPresetId) => {
    if (preset === "personalizada") {
      setDraft({
        preset: "personalizada",
        creases: [],
        operations: [],
        basePanelId: null,
      });
      setSelectedOpId(null);
      return;
    }
    const next = applyPresetToFolheto(folheto, preset, w, h);
    const isCarteira =
      preset === "triptico_carteira_esquerda" ||
      preset === "triptico_carteira_direita";
    if (!isCarteira) {
      setDraft({
        preset,
        creases: next.creases,
        operations: next.operations,
        basePanelId: null,
      });
      setSelectedOpId(null);
      return;
    }
    const def = toSheetDefinition(next, w, h);
    const topo = buildFoldTopology(def);
    const center =
      topo.panels.find((p) => p.column === 1 && topo.panels.length === 3) ?? null;
    if (!center) {
      setDraft({
        preset,
        creases: next.creases,
        operations: next.operations,
        basePanelId: null,
      });
    } else {
      setDraft({
        preset,
        creases: next.creases,
        operations: syncOperationsToBasePanel(
          topo,
          next.creases,
          next.operations,
          center.id,
        ),
        basePanelId: center.id,
      });
    }
    setSelectedOpId(null);
  };

  const addCrease = (axis: "vertical" | "horizontal") => {
    const id = `c${Date.now().toString(36)}`;
    const positionMm = Math.round((axis === "vertical" ? w : h) * 50) / 100;
    const crease: FoldCrease = { id, axis, positionMm };
    const op: FoldOperation = {
      id: `o${Date.now().toString(36)}`,
      creaseId: id,
      order: value.operations.length + 1,
      movingSide: "positive",
      towards: "front",
      targetAngleDeg: 180,
    };
    setDraft({
      preset: "personalizada",
      creases: [...value.creases, crease],
      operations: [...value.operations, op],
    });
    setSelectedOpId(op.id);
  };

  const removeCrease = (creaseId: string) => {
    const creases = value.creases.filter((c) => c.id !== creaseId);
    const operations = value.operations
      .filter((o) => o.creaseId !== creaseId)
      .map((o, i) => ({ ...o, order: i + 1 }));
    setDraft({
      preset: "personalizada",
      creases,
      operations,
      basePanelId: null,
    });
    if (selectedOpId && !operations.some((o) => o.id === selectedOpId)) {
      setSelectedOpId(operations[0]?.id ?? null);
    }
  };

  const updateCreasePos = (creaseId: string, positionMm: number) => {
    setDraft({
      preset: "personalizada",
      creases: value.creases.map((c) =>
        c.id === creaseId
          ? {
              ...c,
              positionMm: Math.round(positionMm * 100) / 100,
            }
          : c,
      ),
    });
  };

  const updateOperation = (opId: string, patch: Partial<FoldOperation>) => {
    let operations = value.operations.map((o) => {
      if (o.id !== opId) return o;
      const next = { ...o, ...patch };
      if (
        Object.prototype.hasOwnProperty.call(patch, "startAfterPrevOpen01") &&
        patch.startAfterPrevOpen01 == null
      ) {
        delete next.startAfterPrevOpen01;
      }
      return next;
    });
    if (value.basePanelId && value.creases.length) {
      const def = toSheetDefinition(
        { ...folheto, operations },
        w,
        h,
      );
      operations = syncOperationsToBasePanel(
        buildFoldTopology(def),
        value.creases,
        operations,
        value.basePanelId,
      );
    }
    setDraft({ preset: "personalizada", operations });
  };

  const setBasePanelId = (basePanelId: string | null) => {
    if (!basePanelId || !value.creases.length) {
      setDraft({ basePanelId: null });
      return;
    }
    const def = toSheetDefinition(folheto, w, h);
    const topo = buildFoldTopology(def);
    setDraft({
      basePanelId,
      operations: syncOperationsToBasePanel(
        topo,
        value.creases,
        value.operations,
        basePanelId,
      ),
      preset: "personalizada",
    });
  };

  return (
    <div className="mt-3 space-y-3 rounded-xl border border-sagra-border bg-slate-50/80 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold text-neutral-700">
          Configuração da dobra
        </p>
        <select
          value={value.preset}
          onChange={(e) => selectPreset(e.target.value as FoldPresetId)}
          className="rounded-md border border-sagra-border bg-white px-2 py-1.5 text-xs text-neutral-800"
        >
          {FOLD_PRESET_OPTIONS.map((opt) => (
            <option key={opt.id} value={opt.id}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => addCrease("vertical")}
          className="inline-flex items-center gap-1 rounded-lg border border-sagra-border bg-white px-2 py-1 text-xs hover:bg-neutral-50"
        >
          <Plus className="size-3.5" aria-hidden /> Vertical
        </button>
        <button
          type="button"
          onClick={() => addCrease("horizontal")}
          className="inline-flex items-center gap-1 rounded-lg border border-sagra-border bg-white px-2 py-1 text-xs hover:bg-neutral-50"
        >
          <Plus className="size-3.5" aria-hidden /> Horizontal
        </button>
      </div>

      {value.creases.length > 0 ? (
        <ul className="space-y-1.5">
          {value.creases.map((c, i) => (
            <li
              key={c.id}
              className="flex flex-wrap items-center gap-2 rounded-lg border border-sagra-border bg-white px-2 py-1.5 text-xs"
            >
              <span
                className="inline-flex size-5 items-center justify-center rounded-full text-[10px] font-bold text-white"
                style={{
                  background: FOLD_LINE_COLORS[i % FOLD_LINE_COLORS.length],
                }}
              >
                {c.axis === "horizontal" ? "H" : "V"}
              </span>
              <label className="flex items-center gap-1 text-neutral-600">
                Posição (mm)
                <input
                  type="number"
                  min={1}
                  step={0.1}
                  value={c.positionMm}
                  onChange={(e) =>
                    updateCreasePos(c.id, Number(e.target.value) || c.positionMm)
                  }
                  className="w-20 rounded border border-sagra-border px-1.5 py-0.5 tabular-nums"
                />
              </label>
              <button
                type="button"
                onClick={() => removeCrease(c.id)}
                className="ml-auto rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-sagra-danger"
                aria-label="Remover vinco"
              >
                <Trash2 className="size-3.5" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-lg border border-dashed border-sagra-border bg-white px-3 py-3 text-center text-xs text-neutral-500">
          Nenhum vinco. Escolha um preset ou adicione Vertical/Horizontal.
        </p>
      )}

      {value.creases.length > 0 ? (
        <label className="flex flex-wrap items-center gap-2 text-xs text-neutral-700">
          <span className="font-medium">Painel parado (miolo)</span>
          <select
            value={value.basePanelId ?? ""}
            onChange={(e) =>
              setBasePanelId(e.target.value ? e.target.value : null)
            }
            className="rounded-md border border-sagra-border bg-white px-2 py-1 text-xs"
          >
            <option value="">Manual (por operação)</option>
            {topology.panels.map((p) => (
              <option key={p.id} value={p.id}>
                {p.id}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {pdfPath && ano > 0 && osId > 0 && value.creases.length > 0 ? (
        <FoldSchemaPreview
          ano={ano}
          osId={osId}
          arquivoUnico={pdfPath}
          folheto={folheto}
          topology={topology}
          usable={{ w, h }}
          pageWidthMm={w}
          pageHeightMm={h}
          selectedOpId={selectedOp?.id ?? null}
          movingIds={movingIds}
        />
      ) : null}

      {value.operations.length > 0 ? (
        <ul className="space-y-2">
          {[...value.operations]
            .sort((a, b) => a.order - b.order)
            .map((o, i) => {
              const crease = value.creases.find((c) => c.id === o.creaseId);
              const maxUnfoldOrder = Math.max(
                ...value.operations.map((x) => x.order),
                1,
              );
              const firstToOpen = o.order === maxUnfoldOrder;
              const staggerPct = Math.round((o.startAfterPrevOpen01 ?? 1) * 100);
              return (
                <li
                  key={o.id}
                  className={`flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2 ${
                    selectedOp?.id === o.id
                      ? "border-primary-green bg-primary-green/5"
                      : "border-sagra-border bg-white"
                  }`}
                >
                  <button
                    type="button"
                    className="flex size-7 items-center justify-center rounded-full text-xs font-bold text-white"
                    style={{
                      background: FOLD_LINE_COLORS[i % FOLD_LINE_COLORS.length],
                    }}
                    onClick={() => setSelectedOpId(o.id)}
                    title={`Fecha ${o.order}º`}
                  >
                    {o.order}
                  </button>
                  <select
                    value={o.movingSide}
                    onChange={(e) =>
                      updateOperation(o.id, {
                        movingSide: e.target.value as FoldMovingSide,
                      })
                    }
                    className="rounded-lg border border-sagra-border bg-white px-2 py-1 text-xs"
                  >
                    <option value="negative">
                      {crease?.axis === "horizontal"
                        ? "Móvel: superior"
                        : "Móvel: esquerdo"}
                    </option>
                    <option value="positive">
                      {crease?.axis === "horizontal"
                        ? "Móvel: inferior"
                        : "Móvel: direito"}
                    </option>
                  </select>
                  <select
                    value={o.towards}
                    onChange={(e) =>
                      updateOperation(o.id, {
                        towards: e.target.value as FoldTowards,
                      })
                    }
                    className="rounded-lg border border-sagra-border bg-white px-2 py-1 text-xs"
                  >
                    <option value="front">Sobre a frente</option>
                    <option value="back">Sobre o verso</option>
                  </select>
                  <label
                    className="flex items-center gap-1 text-[10px] text-neutral-600"
                    title="Ângulo alvo da dobra (°)"
                  >
                    <span>Ângulo</span>
                    <input
                      type="number"
                      min={1}
                      max={180}
                      value={o.targetAngleDeg}
                      onChange={(e) =>
                        updateOperation(o.id, {
                          targetAngleDeg: Math.min(
                            180,
                            Math.max(1, Number(e.target.value) || 180),
                          ),
                        })
                      }
                      className="w-14 rounded-lg border border-sagra-border bg-white px-1.5 py-1 text-xs tabular-nums"
                    />
                  </label>
                  {firstToOpen ? (
                    <span
                      className="rounded-lg border border-dashed border-sagra-border bg-white px-2 py-1 text-[10px] text-neutral-400"
                      title="Primeira a abrir no desdobrar — não espera outra operação."
                    >
                      Início
                    </span>
                  ) : (
                    <label
                      className="flex items-center gap-1 text-[10px] text-neutral-600"
                      title="Quando a operação anterior (no desdobrar) atingir esta % aberta, esta começa. 100 = só depois de totalmente aberta (padrão). Valores menores = execução simultânea/sobreposta."
                    >
                      <span className="whitespace-nowrap">Após ant. %</span>
                      <input
                        type="number"
                        min={0}
                        max={100}
                        step={5}
                        value={staggerPct}
                        onChange={(e) => {
                          const v = Math.min(
                            100,
                            Math.max(0, Number(e.target.value) || 0),
                          );
                          updateOperation(o.id, {
                            startAfterPrevOpen01:
                              v >= 100 ? undefined : v / 100,
                          });
                        }}
                        className="w-14 rounded-lg border border-sagra-border bg-white px-1.5 py-1 text-xs tabular-nums"
                      />
                    </label>
                  )}
                </li>
              );
            })}
        </ul>
      ) : null}
    </div>
  );
}
