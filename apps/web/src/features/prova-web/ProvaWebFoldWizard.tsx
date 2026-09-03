import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Loader2,
  Pencil,
  Plus,
  Save,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import type {
  CropSidesMm,
  FoldCrease,
  FoldModelConfig,
  FoldMovingSide,
  FoldOperation,
  FoldPresetId,
  FoldTowards,
  ProvaWebCropJson,
  ProvaWebFoldModel,
  ProvaWebFolhetoCrop,
} from "@/api/provaWeb";
import {
  createProvaWebFoldModel,
  deleteProvaWebFoldModel,
  fetchProvaWebFoldModels,
  updateProvaWebFoldModel,
} from "@/api/provaWeb";

import {
  buildFoldTopology,
  progressWithPriorsClosed,
  resolveMovingPanelsWithHistory,
  resolveMovingSideForBase,
  syncOperationsToBasePanel,
  validateFoldDefinition,
} from "./fold-engine";
import { ProvaWebCropPanel } from "./ProvaWebCropPanel";
import { FoldSchemaPreview } from "./FoldSchemaPreview";
import { FoldStepPreview } from "./FoldStepPreview";
import { useProvaWebPdfPageRaster } from "./useProvaWebPdfPageRaster";
import {
  applyFoldModelConfig,
  applyPresetToFolheto,
  clampCreasePosition,
  creasesAsFoldLines,
  defaultFolhetoCrop,
  ensureMirrorCrease,
  FOLD_LINE_COLORS,
  FOLD_PRESET_OPTIONS,
  hydrateFolhetoFromInitial,
  isLegacyFolhetoConfig,
  packFoldModelConfig,
  resolveFolhetoDuplexPages,
  sheetFromPreset,
  toSheetDefinition,
  usableAfterCrop,
} from "./provaWebFoldPresets";
import { DEFAULT_ARTWORK_BACK } from "./fold-engine/foldTypes";
import { useProvaWebCropMeta } from "./useProvaWebCropMeta";

const FOLD_MODELS_QUERY_KEY = ["prova-web", "fold-models"] as const;

export interface ProvaWebFoldWizardProps {
  ano: number;
  osId: number;
  arquivoUnico: string;
  saving?: boolean;
  onBack: () => void;
  onConfirm: (cropJson: ProvaWebCropJson) => void;
  formato?: string | null;
  formatoAlturaMm?: number | null;
  formatoLarguraMm?: number | null;
  /** Crop/config do registro (editar rascunho). */
  initialFolheto?: unknown;
}

export function ProvaWebFoldWizard({
  ano,
  osId,
  arquivoUnico,
  saving = false,
  onBack,
  onConfirm,
  formato = null,
  formatoAlturaMm = null,
  formatoLarguraMm = null,
  initialFolheto,
}: ProvaWebFoldWizardProps) {
  const legacy = isLegacyFolhetoConfig(initialFolheto);
  const [folheto, setFolheto] = useState<ProvaWebFolhetoCrop>(() =>
    hydrateFolhetoFromInitial(initialFolheto) ?? defaultFolhetoCrop(),
  );
  const [previewPage, setPreviewPage] = useState(0);
  const [selectedOpId, setSelectedOpId] = useState<string | null>(null);
  const [activeSavedModelId, setActiveSavedModelId] = useState<number | null>(
    null,
  );
  /** Rascunho de posição mm enquanto digita (evita clamp a cada tecla). */
  const [posDraftByCrease, setPosDraftByCrease] = useState<
    Record<string, string>
  >({});
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveNome, setSaveNome] = useState("");
  const [saveHint, setSaveHint] = useState("");
  const [editingModel, setEditingModel] = useState<ProvaWebFoldModel | null>(
    null,
  );
  const [editNome, setEditNome] = useState("");
  const [editHint, setEditHint] = useState("");
  const [editReplaceGeometry, setEditReplaceGeometry] = useState(false);
  const [modelMessage, setModelMessage] = useState<string | null>(null);

  const queryClient = useQueryClient();
  const modelsQuery = useQuery({
    queryKey: FOLD_MODELS_QUERY_KEY,
    queryFn: () => fetchProvaWebFoldModels(),
  });

  const metaQuery = useProvaWebCropMeta(ano, osId, arquivoUnico);
  const pageCount = metaQuery.data?.pageCount ?? 1;
  const pageMeta =
    metaQuery.data?.pages.find((p) => p.pageIndex === 0) ??
    metaQuery.data?.pages[0];
  const pageW = pageMeta?.widthMm ?? metaQuery.data?.widthMm ?? 210;
  const pageH = pageMeta?.heightMm ?? metaQuery.data?.heightMm ?? 297;

  const usable = useMemo(
    () => usableAfterCrop(pageW, pageH, folheto.crop),
    [pageW, pageH, folheto.crop],
  );

  const duplexTurn = true;
  const previewIsVerso =
    pageCount > 1 &&
    folheto.pageVerso != null &&
    previewPage === folheto.pageVerso;
  /** No verso com duplex: vincos espelhados (frente 97 → última a 97 da outra borda). */
  const mirrorFoldGuides = Boolean(duplexTurn && previewIsVerso);

  const sheetDef = useMemo(
    () => toSheetDefinition(folheto, usable.w, usable.h),
    [folheto, usable.w, usable.h],
  );
  const topology = useMemo(() => buildFoldTopology(sheetDef), [sheetDef]);
  const issues = useMemo(
    () => validateFoldDefinition(sheetDef),
    [sheetDef],
  );
  const hasErrors = issues.some((i) => i.level === "error");

  const pageFrenteIdx = Math.max(0, folheto.pageFrente ?? 0);
  const stepArtFront = useProvaWebPdfPageRaster({
    ano,
    osId,
    relativePath: arquivoUnico,
    pageIndex: pageFrenteIdx,
    crop: folheto.crop,
    pageWidthMm: pageW,
    pageHeightMm: pageH,
    enabled: folheto.creases.length > 0 && folheto.operations.length > 0,
  });
  const stepArtLoading = stepArtFront.loading;

  const setCrop = useCallback(
    (crop: CropSidesMm) => {
      setFolheto((prev) => {
        const { w, h } = usableAfterCrop(pageW, pageH, crop);
        const prevUsable = usableAfterCrop(pageW, pageH, prev.crop);
        const creases = prev.creases.map((c) => {
          const span0 = c.axis === "vertical" ? prevUsable.w : prevUsable.h;
          const span1 = c.axis === "vertical" ? w : h;
          const frac = span0 > 0 ? c.positionMm / span0 : 0.5;
          return {
            ...c,
            positionMm: clampCreasePosition(
              span1 * frac,
              c.axis,
              w,
              h,
              prev.creases.filter((x) => x.id !== c.id),
            ),
          };
        });
        return {
          ...prev,
          crop,
          creases,
        };
      });
    },
    [pageH, pageW],
  );

  const stableCrop = useCallback((c: CropSidesMm) => setCrop(c), [setCrop]);

  useEffect(() => {
    setFolheto((p) => {
      const duplex = resolveFolhetoDuplexPages(
        pageCount,
        p.pageFrente,
        p.pageVerso,
      );
      return {
        ...p,
        pageFrente: duplex.pageFrente,
        pageVerso: duplex.pageVerso,
        backArtworkTransform: {
          ...(p.backArtworkTransform ?? DEFAULT_ARTWORK_BACK),
          mirrorX: true,
        },
      };
    });
  }, [pageCount]);

  const cropJson: ProvaWebCropJson = useMemo(() => {
    const duplex = resolveFolhetoDuplexPages(
      pageCount,
      folheto.pageFrente,
      folheto.pageVerso,
    );
    return {
      folheto: {
        ...folheto,
        preset: "personalizada",
        pageFrente: duplex.pageFrente,
        pageVerso: duplex.pageVerso,
        backArtworkTransform: {
          ...(folheto.backArtworkTransform ?? DEFAULT_ARTWORK_BACK),
          mirrorX: true,
        },
        panelPages: undefined,
      },
    };
  }, [folheto, pageCount]);

  const currentModelConfig = useCallback((): FoldModelConfig => {
    return packFoldModelConfig(folheto, usable.w, usable.h);
  }, [folheto, usable.w, usable.h]);

  const applySavedModel = (model: ProvaWebFoldModel) => {
    setFolheto((prev) =>
      applyFoldModelConfig(prev, model.config, usable.w, usable.h, {
        pageCount,
      }),
    );
    setActiveSavedModelId(model.id);
    setSelectedOpId(null);
    setModelMessage(null);
  };

  const selectPreset = (preset: FoldPresetId) => {
    if (preset === "personalizada") {
      setActiveSavedModelId(null);
      setFolheto((prev) => ({
        ...prev,
        preset: "personalizada",
        creases: [],
        operations: [],
        basePanelId: null,
      }));
      setSelectedOpId(null);
      return;
    }
    setActiveSavedModelId(null);
    setFolheto((prev) => {
      const next = applyPresetToFolheto(prev, preset, pageW, pageH);
      // Carteira: miolo = painel central
      const isCarteira =
        preset === "triptico_carteira_esquerda" ||
        preset === "triptico_carteira_direita";
      if (!isCarteira) {
        return { ...next, basePanelId: null };
      }
      const def = toSheetDefinition(next, usable.w, usable.h);
      const topo = buildFoldTopology(def);
      const center =
        topo.panels.find((p) => p.column === 1 && topo.panels.length === 3) ??
        null;
      if (!center) return { ...next, basePanelId: null };
      return {
        ...next,
        basePanelId: center.id,
        operations: syncOperationsToBasePanel(
          topo,
          next.creases,
          next.operations,
          center.id,
        ),
      };
    });
    setSelectedOpId(null);
  };

  const createModelMut = useMutation({
    mutationFn: () =>
      createProvaWebFoldModel({
        nome: saveNome.trim(),
        hint: saveHint.trim(),
        config: currentModelConfig(),
      }),
    onSuccess: (res) => {
      void queryClient.invalidateQueries({ queryKey: FOLD_MODELS_QUERY_KEY });
      setActiveSavedModelId(res.model.id);
      setSaveOpen(false);
      setSaveNome("");
      setSaveHint("");
      setModelMessage(`Modelo “${res.model.nome}” salvo para todos os usuários.`);
    },
    onError: (err) => {
      setModelMessage(
        err instanceof Error ? err.message : "Falha ao salvar o modelo.",
      );
    },
  });

  const updateModelMut = useMutation({
    mutationFn: () => {
      if (!editingModel) throw new Error("Nenhum modelo selecionado.");
      return updateProvaWebFoldModel(editingModel.id, {
        nome: editNome.trim(),
        hint: editHint.trim(),
        ...(editReplaceGeometry ? { config: currentModelConfig() } : {}),
      });
    },
    onSuccess: (res) => {
      void queryClient.invalidateQueries({ queryKey: FOLD_MODELS_QUERY_KEY });
      if (editReplaceGeometry) {
        setActiveSavedModelId(res.model.id);
      }
      setEditingModel(null);
      setModelMessage(`Modelo “${res.model.nome}” atualizado.`);
    },
    onError: (err) => {
      setModelMessage(
        err instanceof Error ? err.message : "Falha ao atualizar o modelo.",
      );
    },
  });

  const deleteModelMut = useMutation({
    mutationFn: (id: number) => deleteProvaWebFoldModel(id),
    onSuccess: (_res, id) => {
      void queryClient.invalidateQueries({ queryKey: FOLD_MODELS_QUERY_KEY });
      if (activeSavedModelId === id) setActiveSavedModelId(null);
      setModelMessage("Modelo excluído.");
    },
    onError: (err) => {
      setModelMessage(
        err instanceof Error ? err.message : "Falha ao excluir o modelo.",
      );
    },
  });

  const updateCreasePos = (id: string, positionMm: number) => {
    setActiveSavedModelId(null);
    setFolheto((prev) => {
      const others = prev.creases.filter((c) => c.id !== id);
      const creases = prev.creases.map((c) =>
        c.id === id
          ? {
              ...c,
              positionMm: clampCreasePosition(
                positionMm,
                c.axis,
                usable.w,
                usable.h,
                others,
              ),
            }
          : c,
      );
      let operations = prev.operations;
      if (prev.basePanelId) {
        const def = toSheetDefinition(
          { ...prev, creases },
          usable.w,
          usable.h,
        );
        operations = syncOperationsToBasePanel(
          buildFoldTopology(def),
          creases,
          prev.operations,
          prev.basePanelId,
        );
      }
      return {
        ...prev,
        preset: "personalizada",
        creases,
        operations,
      };
    });
  };

  const commitCreasePos = (id: string, draft: string) => {
    const crease = folheto.creases.find((c) => c.id === id);
    if (!crease) {
      setPosDraftByCrease((p) => {
        const next = { ...p };
        delete next[id];
        return next;
      });
      return;
    }
    const normalized = draft.replace(",", ".").trim();
    const raw = Number(normalized);
    if (!Number.isFinite(raw)) {
      setPosDraftByCrease((p) => {
        const next = { ...p };
        delete next[id];
        return next;
      });
      return;
    }
    updateCreasePos(id, raw);
    setPosDraftByCrease((p) => {
      const next = { ...p };
      delete next[id];
      return next;
    });
  };

  const updateOperation = (id: string, patch: Partial<FoldOperation>) => {
    setActiveSavedModelId(null);
    setFolheto((prev) => {
      // Ajuste manual do lado móvel sai do modo “miolo automático”
      const clearBase =
        patch.movingSide != null ? { basePanelId: null as string | null } : {};
      return {
        ...prev,
        ...clearBase,
        preset: "personalizada",
        operations: prev.operations.map((o) => {
          if (o.id !== id) return o;
          const next = { ...o, ...patch };
          if (
            Object.prototype.hasOwnProperty.call(patch, "startAfterPrevOpen01") &&
            patch.startAfterPrevOpen01 == null
          ) {
            delete next.startAfterPrevOpen01;
          }
          return next;
        }),
      };
    });
  };

  const setBasePanelId = (panelId: string | null) => {
    setActiveSavedModelId(null);
    setFolheto((prev) => {
      if (!panelId) {
        return { ...prev, basePanelId: null, preset: "personalizada" };
      }
      const def = toSheetDefinition(prev, usable.w, usable.h);
      const topo = buildFoldTopology(def);
      return {
        ...prev,
        preset: "personalizada",
        basePanelId: panelId,
        operations: syncOperationsToBasePanel(
          topo,
          prev.creases,
          prev.operations,
          panelId,
        ),
      };
    });
  };

  const moveOpOrder = (id: string, dir: -1 | 1) => {
    setActiveSavedModelId(null);
    setFolheto((prev) => {
      const sorted = [...prev.operations].sort((a, b) => a.order - b.order);
      const idx = sorted.findIndex((d) => d.id === id);
      const swap = idx + dir;
      if (idx < 0 || swap < 0 || swap >= sorted.length) return prev;
      const a = sorted[idx]!;
      const b = sorted[swap]!;
      const orderA = a.order;
      return {
        ...prev,
        preset: "personalizada",
        operations: prev.operations.map((o) => {
          if (o.id === a.id) return { ...o, order: b.order };
          if (o.id === b.id) return { ...o, order: orderA };
          return o;
        }),
      };
    });
  };

  const addCrease = (axis: FoldCrease["axis"]) => {
    setActiveSavedModelId(null);
    setFolheto((prev) => {
      let maxN = 0;
      for (const c of prev.creases) {
        const m = /^c(\d+)$/.exec(c.id);
        if (m) maxN = Math.max(maxN, Number(m[1]));
      }
      for (const o of prev.operations) {
        const m = /^o(\d+)$/.exec(o.id);
        if (m) maxN = Math.max(maxN, Number(m[1]));
      }
      const n = maxN + 1;
      const id = `c${n}`;
      const span = axis === "vertical" ? usable.w : usable.h;
      // Preferir 1/4 se o meio já tem vinco do mesmo eixo (ex.: 3ª dobra zine).
      const sameAxis = prev.creases.filter((c) => c.axis === axis);
      const midTaken = sameAxis.some(
        (c) => Math.abs(c.positionMm - span * 0.5) < 15,
      );
      const preferredFrac = midTaken ? 0.25 : 0.5;
      const crease: FoldCrease = {
        id,
        axis,
        positionMm: clampCreasePosition(
          span * preferredFrac,
          axis,
          usable.w,
          usable.h,
          prev.creases,
        ),
      };
      const maxOrder = Math.max(0, ...prev.operations.map((o) => o.order));
      let movingSide: FoldMovingSide = "positive";
      let idSeq = n + 1;
      let creasesDraft = ensureMirrorCrease(
        [...prev.creases, crease],
        axis,
        crease.positionMm,
        span,
        () => `c${idSeq++}`,
      );
      const defDraft = toSheetDefinition(
        { ...prev, creases: creasesDraft, operations: prev.operations },
        usable.w,
        usable.h,
      );
      const topoDraft = buildFoldTopology(defDraft);
      if (prev.basePanelId) {
        const side = resolveMovingSideForBase(
          topoDraft,
          crease,
          creasesDraft,
          prev.basePanelId,
          { id: `o${n}`, creaseId: id, order: maxOrder + 1 },
        );
        if (side) movingSide = side;
      }
      const operation: FoldOperation = {
        id: `o${n}`,
        creaseId: id,
        order: maxOrder + 1,
        movingSide,
        towards: "front",
        targetAngleDeg: 180,
      };
      let operations = [...prev.operations, operation];
      if (prev.basePanelId) {
        operations = syncOperationsToBasePanel(
          topoDraft,
          creasesDraft,
          operations,
          prev.basePanelId,
        );
      }
      return {
        ...prev,
        preset: "personalizada",
        creases: creasesDraft,
        operations,
      };
    });
  };

  const removeCrease = (creaseId: string) => {
    setActiveSavedModelId(null);
    setFolheto((prev) => {
      const creases = prev.creases.filter((c) => c.id !== creaseId);
      const operations = prev.operations.filter((o) => o.creaseId !== creaseId);
      return {
        ...prev,
        preset: "personalizada",
        creases,
        operations,
      };
    });
    setSelectedOpId(null);
  };

  const selectedOp =
    folheto.operations.find((o) => o.id === selectedOpId) ??
    folheto.operations[0] ??
    null;
  const movingIds = useMemo(() => {
    if (!selectedOp) return new Set<string>();
    return resolveMovingPanelsWithHistory({
      topology,
      operation: selectedOp,
      creases: folheto.creases,
      operations: folheto.operations,
      progressByOp: progressWithPriorsClosed(folheto.operations, selectedOp),
    });
  }, [selectedOp, topology, folheto.creases, folheto.operations]);

  return (
    <div className="mx-auto flex min-h-0 w-full max-w-5xl flex-1 flex-col gap-4 p-4">
      <div className="shrink-0">
        <h2 className="text-sm font-semibold text-neutral-800">
          Assistente — Folheto dobrado
        </h2>
        <p className="mt-0.5 text-xs text-neutral-500">
          Use um modelo pronto do sistema, um modelo salvo, ou monte os vincos
          manualmente.
        </p>
      </div>

      {legacy && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          Este registro usa o formato antigo de dobras. Reconfigure os vincos
          abaixo (corte limpo do modelo) antes de gerar a prova.
        </p>
      )}

      {pageCount > 2 && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          Este PDF tem {pageCount} páginas. Serão usadas só as páginas 2
          (frente) e 1 (verso). Use “Inverter páginas” se precisar trocar.
        </p>
      )}

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto pb-2">
        <section className="space-y-3 rounded-2xl border border-sagra-border bg-white p-4 shadow-sm">
          <h3 className="text-sm font-semibold text-neutral-800">
            Modelos prontos do sistema
          </h3>
          <p className="text-xs text-neutral-500">
            Atalhos tipográficos. Depois de aplicar, você ainda pode ajustar
            vincos, miolo e páginas.
          </p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {FOLD_PRESET_OPTIONS.map((opt) => {
              const active =
                activeSavedModelId == null && folheto.preset === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => selectPreset(opt.id)}
                  className={`rounded-xl border px-3 py-3 text-left transition ${
                    active
                      ? "border-primary-green bg-primary-green/10 ring-1 ring-primary-green/40"
                      : "border-sagra-border bg-slate-50 hover:bg-neutral-100"
                  }`}
                >
                  <PresetDiagram preset={opt.id} />
                  <p className="mt-2 text-sm font-medium text-neutral-800">
                    {opt.label}
                  </p>
                  <p className="text-[11px] text-neutral-500">{opt.hint}</p>
                </button>
              );
            })}
          </div>
        </section>

        <section className="space-y-3 rounded-2xl border border-sagra-border bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-neutral-800">
                Modelos salvos pelos usuários
              </h3>
              <p className="text-xs text-neutral-500">
                Compartilhados no sistema. Salvam vincos, operações, páginas
                frente/verso, miolo e duplex (não o crop).
              </p>
            </div>
            <button
              type="button"
              disabled={hasErrors || createModelMut.isPending}
              onClick={() => {
                setSaveOpen(true);
                setModelMessage(null);
              }}
              className="inline-flex items-center gap-1.5 rounded-lg border border-sagra-border bg-white px-3 py-1.5 text-xs font-medium text-neutral-800 hover:bg-neutral-50 disabled:opacity-50"
            >
              <Save className="size-3.5" />
              Salvar modelo atual
            </button>
          </div>

          {modelMessage && (
            <p className="rounded-lg border border-sagra-border bg-slate-50 px-3 py-2 text-xs text-neutral-700">
              {modelMessage}
            </p>
          )}

          {saveOpen && (
            <div className="space-y-2 rounded-xl border border-primary-green/30 bg-primary-green/5 p-3">
              <p className="text-xs font-medium text-neutral-800">
                Novo modelo compartilhado
              </p>
              <label className="flex flex-col gap-1 text-xs text-neutral-700">
                Nome
                <input
                  value={saveNome}
                  onChange={(e) => setSaveNome(e.target.value)}
                  className="rounded-lg border border-sagra-border bg-white px-2 py-1.5 text-sm"
                  placeholder="Ex.: Carteira 90×210"
                  maxLength={120}
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-neutral-700">
                Descrição (opcional)
                <input
                  value={saveHint}
                  onChange={(e) => setSaveHint(e.target.value)}
                  className="rounded-lg border border-sagra-border bg-white px-2 py-1.5 text-sm"
                  placeholder="Resumo da dobra"
                  maxLength={240}
                />
              </label>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={!saveNome.trim() || createModelMut.isPending}
                  onClick={() => createModelMut.mutate()}
                  className="rounded-lg bg-primary-green px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                >
                  {createModelMut.isPending ? "Salvando…" : "Confirmar"}
                </button>
                <button
                  type="button"
                  onClick={() => setSaveOpen(false)}
                  className="rounded-lg border border-sagra-border bg-white px-3 py-1.5 text-xs"
                >
                  Cancelar
                </button>
              </div>
            </div>
          )}

          {editingModel && (
            <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50/60 p-3">
              <p className="text-xs font-medium text-neutral-800">
                Editar modelo
              </p>
              <label className="flex flex-col gap-1 text-xs text-neutral-700">
                Nome
                <input
                  value={editNome}
                  onChange={(e) => setEditNome(e.target.value)}
                  className="rounded-lg border border-sagra-border bg-white px-2 py-1.5 text-sm"
                  maxLength={120}
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-neutral-700">
                Descrição
                <input
                  value={editHint}
                  onChange={(e) => setEditHint(e.target.value)}
                  className="rounded-lg border border-sagra-border bg-white px-2 py-1.5 text-sm"
                  maxLength={240}
                />
              </label>
              <label className="flex items-center gap-2 text-xs text-neutral-700">
                <input
                  type="checkbox"
                  checked={editReplaceGeometry}
                  onChange={(e) => setEditReplaceGeometry(e.target.checked)}
                />
                Substituir geometria, páginas PDF e duplex pela configuração
                atual do assistente
              </label>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={!editNome.trim() || updateModelMut.isPending}
                  onClick={() => updateModelMut.mutate()}
                  className="rounded-lg bg-primary-green px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                >
                  {updateModelMut.isPending ? "Salvando…" : "Salvar alterações"}
                </button>
                <button
                  type="button"
                  onClick={() => setEditingModel(null)}
                  className="rounded-lg border border-sagra-border bg-white px-3 py-1.5 text-xs"
                >
                  Cancelar
                </button>
              </div>
            </div>
          )}

          {modelsQuery.isLoading && (
            <p className="flex items-center gap-2 text-xs text-neutral-500">
              <Loader2 className="size-3.5 animate-spin" />
              Carregando modelos…
            </p>
          )}
          {modelsQuery.isError && (
            <p className="text-xs text-sagra-danger">
              Não foi possível carregar os modelos salvos.
            </p>
          )}
          {(modelsQuery.data?.models.length ?? 0) === 0 &&
            !modelsQuery.isLoading && (
              <p className="text-xs text-neutral-500">
                Nenhum modelo salvo ainda. Ajuste a dobra e use “Salvar modelo
                atual”.
              </p>
            )}
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {(modelsQuery.data?.models ?? []).map((model) => {
              const active = activeSavedModelId === model.id;
              return (
                <div
                  key={model.id}
                  className={`rounded-xl border px-3 py-3 transition ${
                    active
                      ? "border-primary-green bg-primary-green/10 ring-1 ring-primary-green/40"
                      : "border-sagra-border bg-slate-50"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => applySavedModel(model)}
                    className="w-full text-left"
                  >
                    <SavedModelDiagram config={model.config} />
                    <p className="mt-2 text-sm font-medium text-neutral-800">
                      {model.nome}
                    </p>
                    {model.hint ? (
                      <p className="text-[11px] text-neutral-500">
                        {model.hint}
                      </p>
                    ) : null}
                  </button>
                  <div className="mt-2 flex gap-1">
                    <button
                      type="button"
                      title="Editar"
                      onClick={() => {
                        setEditingModel(model);
                        setEditNome(model.nome);
                        setEditHint(model.hint);
                        setEditReplaceGeometry(false);
                        setSaveOpen(false);
                        setModelMessage(null);
                      }}
                      className="inline-flex items-center gap-1 rounded-md border border-sagra-border bg-white px-2 py-1 text-[11px] hover:bg-neutral-50"
                    >
                      <Pencil className="size-3" /> Editar
                    </button>
                    <button
                      type="button"
                      title="Excluir"
                      disabled={deleteModelMut.isPending}
                      onClick={() => {
                        if (
                          window.confirm(
                            `Excluir o modelo “${model.nome}” para todos os usuários?`,
                          )
                        ) {
                          deleteModelMut.mutate(model.id);
                        }
                      }}
                      className="inline-flex items-center gap-1 rounded-md border border-red-200 bg-white px-2 py-1 text-[11px] text-red-700 hover:bg-red-50"
                    >
                      <Trash2 className="size-3" /> Excluir
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section className="rounded-2xl border border-sagra-border bg-white p-4 shadow-sm">
          <h3 className="mb-3 text-sm font-semibold text-neutral-800">
            Crop e marcas de vinco
          </h3>
          <ProvaWebCropPanel
            ano={ano}
            osId={osId}
            relativePath={arquivoUnico}
            title="Crop da folha (mm)"
            crop={folheto.crop}
            onChange={stableCrop}
            pageIndex={previewPage}
            onPageIndexChange={setPreviewPage}
            showPageSelector={pageCount > 1}
            foldLines={creasesAsFoldLines(folheto.creases).map((c, i) => ({
              ...c,
              ordem: i + 1,
              posicaoMm:
                mirrorFoldGuides && c.eixo === "vertical"
                  ? Math.round((usable.w - c.posicaoMm) * 10) / 10
                  : c.posicaoMm,
            }))}
            onFoldPosicaoChange={(id, posicaoMm) => {
              const crease = folheto.creases.find((c) => c.id === id);
              const stored =
                mirrorFoldGuides && crease?.axis === "vertical"
                  ? usable.w - posicaoMm
                  : posicaoMm;
              updateCreasePos(id, stored);
            }}
            formatoLabel={formato}
            formatoLarguraMm={formatoLarguraMm}
            formatoAlturaMm={formatoAlturaMm}
          />
          {mirrorFoldGuides && (
            <p className="mt-2 text-[11px] text-neutral-500">
              Vincos no verso espelhados (duplex): se a primeira dobra na frente
              é 97 mm, no verso a marca correspondente fica a 97 mm da outra
              borda — alinhada ao PDF espelhado.
            </p>
          )}
          {folheto.creases.length > 0 && (
            <div className="mt-4 space-y-2 border-t border-sagra-border pt-3">
              <p className="text-xs font-medium text-neutral-800">
                Posição dos vincos (mm na área útil)
              </p>
              <ul className="flex flex-wrap gap-2">
                {folheto.creases.map((crease, i) => {
                  const span =
                    crease.axis === "horizontal" ? usable.h : usable.w;
                  return (
                    <li
                      key={crease.id}
                      className="flex items-center gap-1.5 rounded-xl border border-sagra-border bg-slate-50 px-2.5 py-1.5"
                    >
                      <span
                        className="flex size-5 items-center justify-center rounded-full text-[10px] font-bold text-white"
                        style={{
                          background:
                            FOLD_LINE_COLORS[i % FOLD_LINE_COLORS.length],
                        }}
                      >
                        {i + 1}
                      </span>
                      <span className="text-xs font-semibold text-neutral-700">
                        {crease.axis === "horizontal" ? "H" : "V"}
                      </span>
                      <label className="flex items-center gap-1 text-xs text-neutral-600">
                        <span className="sr-only">Posição</span>
                        <input
                          type="text"
                          inputMode="decimal"
                          value={
                            posDraftByCrease[crease.id] ??
                            String(Math.round(crease.positionMm * 10) / 10)
                          }
                          onChange={(e) => {
                            const v = e.target.value;
                            if (v !== "" && !/^-?\d*[.,]?\d*$/.test(v)) return;
                            setPosDraftByCrease((p) => ({
                              ...p,
                              [crease.id]: v,
                            }));
                          }}
                          onBlur={() => {
                            commitCreasePos(
                              crease.id,
                              posDraftByCrease[crease.id] ??
                                String(crease.positionMm),
                            );
                          }}
                          onKeyDown={(e) => {
                            if (e.key !== "Enter") return;
                            e.currentTarget.blur();
                          }}
                          className="w-20 rounded-lg border border-sagra-border bg-white px-2 py-1 text-xs tabular-nums"
                          title={`Posição em mm (área útil ~${span.toFixed(1)} mm). Enter ou saia do campo para aplicar.`}
                        />
                        <span className="text-neutral-400">mm</span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </section>

        <section className="space-y-3 rounded-2xl border border-sagra-border bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-neutral-800">
                Vincos e operações
              </h3>
              <p className="text-xs text-neutral-500">
                Inclua linhas verticais e/ou horizontais. Ajuste a posição em mm
                na seção de crop acima.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {pageCount >= 2 && (
                <button
                  type="button"
                  onClick={() =>
                    setFolheto((p) => {
                      const frente = p.pageFrente ?? 1;
                      const verso = p.pageVerso ?? 0;
                      return { ...p, pageFrente: verso, pageVerso: frente };
                    })
                  }
                  className="rounded-lg border border-sagra-border bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
                >
                  Inverter páginas
                </button>
              )}
              <button
                type="button"
                onClick={() => addCrease("vertical")}
                className="inline-flex items-center gap-1 rounded-lg border border-sagra-border bg-white px-2 py-1 text-xs hover:bg-neutral-50"
              >
                <Plus className="size-3.5" /> Vertical
              </button>
              <button
                type="button"
                onClick={() => addCrease("horizontal")}
                className="inline-flex items-center gap-1 rounded-lg border border-sagra-border bg-white px-2 py-1 text-xs hover:bg-neutral-50"
              >
                <Plus className="size-3.5" /> Horizontal
              </button>
            </div>
          </div>

          {folheto.creases.length > 0 && (
            <label className="flex flex-wrap items-center gap-2 text-xs text-neutral-700">
              <span className="font-medium">Painel parado (miolo)</span>
              <select
                value={folheto.basePanelId ?? ""}
                onChange={(e) =>
                  setBasePanelId(e.target.value ? e.target.value : null)
                }
                className="rounded-lg border border-sagra-border bg-white px-2 py-1.5 text-sm"
              >
                <option value="">Manual (por operação)</option>
                {topology.panels.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.id}
                    {topology.panels.length === 3 && p.column === 1
                      ? " (centro — estilo carteira)"
                      : ""}
                  </option>
                ))}
              </select>
              <span className="text-[11px] text-neutral-500">
                Ex.: no folder tipo carteira, escolha o painel do meio para ele
                permanecer parado e só as abas laterais se moverem.
              </span>
            </label>
          )}

          {folheto.creases.length > 0 ? (
            <FoldSchemaPreview
              ano={ano}
              osId={osId}
              arquivoUnico={arquivoUnico}
              folheto={folheto}
              topology={topology}
              usable={usable}
              pageWidthMm={pageW}
              pageHeightMm={pageH}
              selectedOpId={selectedOp?.id ?? null}
              movingIds={movingIds}
            />
          ) : (
            <p className="rounded-lg border border-dashed border-sagra-border bg-slate-50 px-3 py-4 text-center text-xs text-neutral-500">
              Nenhum vinco. Use “Vertical” ou “Horizontal”, ou aplique um modelo
              salvo.
            </p>
          )}
          {folheto.creases.length > 0 && (
            <p className="text-[11px] text-neutral-500">
              Configure uma dobra por vez. Abaixo de cada passo aparece a prévia
              do resultado já fechado; a próxima dobra é definida em cima desse
              estado. Clique no número para destacar a aba móvel no esquema.
            </p>
          )}

          <div className="space-y-4">
            {[...folheto.operations]
              .sort((a, b) => a.order - b.order)
              .map((o, i) => {
                const crease = folheto.creases.find((c) => c.id === o.creaseId);
                const maxOrder = Math.max(
                  ...folheto.operations.map((x) => x.order),
                  1,
                );
                return (
                  <div key={o.id} className="space-y-2">
                    <div
                      className={`flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2 ${
                        selectedOp?.id === o.id
                          ? "border-primary-green bg-primary-green/5"
                          : "border-sagra-border bg-slate-50"
                      }`}
                    >
                    <button
                      type="button"
                      className="flex size-7 items-center justify-center rounded-full text-xs font-bold text-white"
                      style={{
                        background:
                          FOLD_LINE_COLORS[i % FOLD_LINE_COLORS.length],
                      }}
                      onClick={() => setSelectedOpId(o.id)}
                      title={`Fecha ${o.order}º`}
                    >
                      {o.order}
                    </button>
                    <span className="text-xs font-medium text-neutral-600">
                      Fecha {o.order}º
                      {o.order === maxOrder ? " (por cima)" : ""}
                    </span>
                    <span className="text-xs font-semibold text-neutral-700">
                      {crease?.axis === "horizontal" ? "H" : "V"}
                    </span>
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
                      <option value="front">Sobre a frente do miolo</option>
                      <option value="back">Sobre o verso do miolo</option>
                    </select>
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
                      className="w-16 rounded-lg border border-sagra-border bg-white px-2 py-1 text-xs tabular-nums"
                      title="Ângulo alvo (°)"
                    />
                    {(() => {
                      const maxUnfoldOrder = Math.max(
                        ...folheto.operations.map((x) => x.order),
                        1,
                      );
                      const firstToOpen = o.order === maxUnfoldOrder;
                      if (firstToOpen) {
                        return (
                          <span
                            className="rounded-lg border border-dashed border-sagra-border bg-white px-2 py-1 text-[10px] text-neutral-400"
                            title="Primeira a abrir no desdobrar — não espera outra operação."
                          >
                            Início
                          </span>
                        );
                      }
                      const pct = Math.round(
                        (o.startAfterPrevOpen01 ?? 1) * 100,
                      );
                      return (
                        <label
                          className="flex items-center gap-1 text-[10px] text-neutral-600"
                          title="Quando a operação anterior (no desdobrar) atingir esta % aberta, esta começa. 100 = só depois de totalmente aberta (padrão)."
                        >
                          <span className="whitespace-nowrap">
                            Após ant. %
                          </span>
                          <input
                            type="number"
                            min={0}
                            max={100}
                            step={5}
                            value={pct}
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
                      );
                    })()}
                    <div className="ml-auto flex gap-1">
                      <button
                        type="button"
                        aria-label="Subir ordem"
                        onClick={() => moveOpOrder(o.id, -1)}
                        className="rounded border border-sagra-border bg-white p-1"
                      >
                        <ArrowUp className="size-3.5" />
                      </button>
                      <button
                        type="button"
                        aria-label="Descer ordem"
                        onClick={() => moveOpOrder(o.id, 1)}
                        className="rounded border border-sagra-border bg-white p-1"
                      >
                        <ArrowDown className="size-3.5" />
                      </button>
                      <button
                        type="button"
                        aria-label="Remover vinco"
                        onClick={() => removeCrease(o.creaseId)}
                        className="rounded border border-sagra-border bg-white p-1 text-sagra-danger"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                    </div>
                    {!hasErrors && (
                      <FoldStepPreview
                        folheto={folheto}
                        topology={topology}
                        usable={usable}
                        stepOrder={o.order}
                        frontDataUrl={stepArtFront.raster?.dataUrl ?? null}
                        artLoading={stepArtLoading}
                      />
                    )}
                  </div>
                );
              })}
          </div>

          {folheto.creases.length > 0 && (
            <div className="flex flex-wrap gap-2 pt-1">
              <button
                type="button"
                onClick={() => addCrease("vertical")}
                className="inline-flex items-center gap-1 rounded-lg border border-primary-green/40 bg-primary-green/5 px-3 py-1.5 text-xs font-medium text-neutral-800 hover:bg-primary-green/10"
              >
                <Plus className="size-3.5" /> Próxima dobra vertical
              </button>
              <button
                type="button"
                onClick={() => addCrease("horizontal")}
                className="inline-flex items-center gap-1 rounded-lg border border-primary-green/40 bg-primary-green/5 px-3 py-1.5 text-xs font-medium text-neutral-800 hover:bg-primary-green/10"
              >
                <Plus className="size-3.5" /> Próxima dobra horizontal
              </button>
            </div>
          )}

          {issues.length > 0 && (
            <ul className="space-y-1 text-xs">
              {issues.map((iss, i) => (
                <li
                  key={`${iss.code}-${i}`}
                  className={
                    iss.level === "error"
                      ? "text-sagra-danger"
                      : iss.level === "warning"
                        ? "text-amber-700"
                        : "text-neutral-500"
                  }
                >
                  {iss.level === "error"
                    ? "Erro"
                    : iss.level === "warning"
                      ? "Aviso"
                      : "Info"}
                  : {iss.message}
                </li>
              ))}
            </ul>
          )}
        </section>

      </div>

      <div className="flex shrink-0 items-center justify-between gap-2 border-t border-sagra-border bg-slate-50/95 py-3">
        <button
          type="button"
          onClick={onBack}
          disabled={saving}
          className="inline-flex items-center gap-1.5 rounded-lg border border-sagra-border bg-white px-4 py-2 text-sm text-neutral-700 shadow-sm hover:bg-neutral-100 disabled:opacity-40"
        >
          <ArrowLeft className="size-4" aria-hidden />
          Voltar
        </button>
        <button
          type="button"
          disabled={saving || hasErrors}
          onClick={() => onConfirm(cropJson)}
          className="inline-flex items-center gap-2 rounded-lg bg-primary-green px-5 py-2 text-sm font-semibold text-white shadow-sm transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {saving && <Loader2 className="size-4 animate-spin" aria-hidden />}
          Gerar Prova WEB
        </button>
      </div>
    </div>
  );
}

function PresetDiagram({ preset }: { preset: FoldPresetId }) {
  const w = 72;
  const h = 48;
  const { creases } =
    preset === "personalizada"
      ? { creases: [] as ReturnType<typeof sheetFromPreset>["creases"] }
      : sheetFromPreset(preset, w, h);
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className="h-12 w-full max-w-[96px]"
      aria-hidden
    >
      <rect
        x={1}
        y={1}
        width={w - 2}
        height={h - 2}
        rx={2}
        fill="#f8fafc"
        stroke="#94a3b8"
        strokeWidth={1}
      />
      {creases.map((d, i) => {
        const color = FOLD_LINE_COLORS[i % FOLD_LINE_COLORS.length];
        if (d.axis === "vertical") {
          return (
            <line
              key={d.id}
              x1={d.positionMm}
              y1={2}
              x2={d.positionMm}
              y2={h - 2}
              stroke={color}
              strokeWidth={1.5}
              strokeDasharray="3 2"
            />
          );
        }
        return (
          <line
            key={d.id}
            x1={2}
            y1={d.positionMm}
            x2={w - 2}
            y2={d.positionMm}
            stroke={color}
            strokeWidth={1.5}
            strokeDasharray="3 2"
          />
        );
      })}
    </svg>
  );
}

function SavedModelDiagram({ config }: { config: FoldModelConfig }) {
  const w = 72;
  const h = 48;
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className="h-12 w-full max-w-[96px]"
      aria-hidden
    >
      <rect
        x={1}
        y={1}
        width={w - 2}
        height={h - 2}
        rx={2}
        fill="#f8fafc"
        stroke="#94a3b8"
        strokeWidth={1}
      />
      {(config.creases ?? []).map((c, i) => {
        const color = FOLD_LINE_COLORS[i % FOLD_LINE_COLORS.length];
        const frac = Math.min(0.98, Math.max(0.02, Number(c.positionFrac) || 0.5));
        if (c.axis === "vertical") {
          const x = frac * w;
          return (
            <line
              key={c.id}
              x1={x}
              y1={2}
              x2={x}
              y2={h - 2}
              stroke={color}
              strokeWidth={1.5}
              strokeDasharray="3 2"
            />
          );
        }
        const y = frac * h;
        return (
          <line
            key={c.id}
            x1={2}
            y1={y}
            x2={w - 2}
            y2={y}
            stroke={color}
            strokeWidth={1.5}
            strokeDasharray="3 2"
          />
        );
      })}
    </svg>
  );
}
