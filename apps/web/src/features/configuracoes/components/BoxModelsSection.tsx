import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Package, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";

import {
  createAdminBoxModel,
  deleteAdminBoxModel,
  fetchAdminBoxModels,
  parseAdminBoxFaca,
  updateAdminBoxModel,
  type BoxModelConfig,
  type ProvaWebBoxModel,
} from "@/api/boxModels";
import { withBasePanel } from "@/features/prova-web/box-engine/boxPanelTree";

import {
  ConfigSection,
  ConfigSectionBody,
  ConfigSectionHeader,
} from "./ConfigSectionLayout";
import { BoxModelDielineEditor } from "./BoxModelDielineEditor";
import {
  addHingeToSequence,
  BoxModelOperationsList,
} from "./BoxModelOperationsList";
import { BoxModelPreview3D } from "./BoxModelPreview3D";

type Draft = {
  id?: number;
  nome: string;
  hint: string;
  config: BoxModelConfig | null;
  file: File | null;
};

const emptyDraft = (): Draft => ({
  nome: "",
  hint: "",
  config: null,
  file: null,
});

export function BoxModelsSection() {
  const qc = useQueryClient();
  const listQuery = useQuery({
    queryKey: ["admin", "box-models"],
    queryFn: () => fetchAdminBoxModels(),
  });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [selectedPanelId, setSelectedPanelId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [selectedHingeId, setSelectedHingeId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [parseWarnings, setParseWarnings] = useState<
    Array<{
      code: string;
      message: string;
      pointMm?: [number, number] | number[] | null;
    }>
  >([]);
  const [focusPointMm, setFocusPointMm] = useState<
    [number, number] | number[] | null
  >(null);

  const parseMut = useMutation({
    mutationFn: (file: File) => parseAdminBoxFaca(file),
    onSuccess: (res, file) => {
      // Mantém operations do SVG (data-fold-order) quando presentes
      const config = res.config;
      setDraft((d) => ({
        ...(d ?? emptyDraft()),
        config,
        file,
        nome: d?.nome || file.name.replace(/\.(svg|pdf)$/i, ""),
      }));
      setSelectedPanelId(res.config.basePanelId);
      setSelectedEdgeId(null);
      setSelectedHingeId(null);
      setParseWarnings(
        res.warnings ?? res.config.parseWarnings ?? [],
      );
      setFocusPointMm(null);
      setError(null);
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : "Falha ao ler a faca.");
    },
  });

  const saveMut = useMutation({
    mutationFn: async () => {
      if (!draft?.config) throw new Error("Importe a faca antes de salvar.");
      if (!draft.nome.trim()) throw new Error("Informe o nome.");
      if (draft.id) {
        return updateAdminBoxModel(draft.id, {
          nome: draft.nome,
          hint: draft.hint,
          config: draft.config,
        });
      }
      return createAdminBoxModel({
        nome: draft.nome,
        hint: draft.hint,
        config: draft.config,
        file: draft.file,
      });
    },
    onSuccess: async () => {
      setDraft(null);
      setError(null);
      await qc.invalidateQueries({ queryKey: ["admin", "box-models"] });
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : "Falha ao salvar.");
    },
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => deleteAdminBoxModel(id),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["admin", "box-models"] });
    },
  });

  const openDraft = (model: ProvaWebBoxModel) => {
    setDraft({
      id: model.id,
      nome: model.nome,
      hint: model.hint,
      config: model.config,
      file: null,
    });
    setSelectedPanelId(model.config.basePanelId);
    setSelectedEdgeId(null);
    setParseWarnings([]);
    setFocusPointMm(null);
    setSelectedHingeId(null);
    setError(null);
  };

  const patchConfig = (fn: (c: BoxModelConfig) => BoxModelConfig) => {
    setDraft((d) => (d?.config ? { ...d, config: fn(d.config) } : d));
  };

  const selectedPanel = draft?.config?.panels.find(
    (p) => p.id === selectedPanelId,
  );
  const selectedEdge = useMemo(() => {
    if (!draft?.config || !selectedEdgeId) return null;
    return (draft.config.edges ?? []).find((e) => e.id === selectedEdgeId) ?? null;
  }, [draft, selectedEdgeId]);

  const selectedHingeIdFromEdge = selectedEdge?.hingeId ?? null;
  const activeHingeId = selectedHingeIdFromEdge ?? selectedHingeId;
  const alreadyInSequence = Boolean(
    activeHingeId &&
      draft?.config?.operations.some((o) => o.hingeId === activeHingeId),
  );

  return (
    <ConfigSection>
      <ConfigSectionHeader
        title="Modelos de caixa (Prova WEB)"
        description="Cadastre a faca em SVG (contrato Sagra: corte_perimetro + camadas corte/dobras). Monte a sequência; mesmo passo = dobras simultâneas."
        icon={<Package className="size-4" aria-hidden />}
        actions={
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-lg bg-primary-green px-2.5 py-1.5 text-xs font-semibold text-white"
            onClick={() => {
              setDraft(emptyDraft());
              setParseWarnings([]);
              setFocusPointMm(null);
            }}
          >
            <Plus className="size-3.5" aria-hidden />
            Novo modelo
          </button>
        }
      />
      <ConfigSectionBody className="space-y-4">
        {listQuery.isLoading ? (
          <p className="flex items-center gap-2 text-sm text-slate-500">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            Carregando…
          </p>
        ) : null}
        {!draft && (
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
            {(listQuery.data ?? []).map((m) => (
              <li
                key={m.id}
                className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
              >
                <button
                  type="button"
                  className="text-left text-sm font-medium text-slate-800 hover:text-primary-green"
                  onClick={() => openDraft(m)}
                >
                  {m.nome}
                  <span className="ml-2 text-xs font-normal text-slate-500">
                    {m.config?.operations?.length ?? 0} dobras ·{" "}
                    {m.config?.panels?.length ?? 0} painéis ·{" "}
                    {m.ativo ? "ativo" : "inativo"}
                  </span>
                  {m.hint ? (
                    <span className="mt-0.5 block text-xs text-slate-500">
                      {m.hint}
                    </span>
                  ) : null}
                </button>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="rounded border border-slate-200 px-2 py-1 text-xs"
                    onClick={() =>
                      void updateAdminBoxModel(m.id, {
                        ativo: !m.ativo,
                      }).then(() =>
                        qc.invalidateQueries({ queryKey: ["admin", "box-models"] }),
                      )
                    }
                  >
                    {m.ativo ? "Desativar" : "Ativar"}
                  </button>
                  <button
                    type="button"
                    className="rounded border border-red-200 px-2 py-1 text-xs text-red-700"
                    onClick={() => {
                      if (confirm(`Excluir modelo “${m.nome}”?`)) {
                        deleteMut.mutate(m.id);
                      }
                    }}
                  >
                    <Trash2 className="size-3.5" aria-hidden />
                  </button>
                </div>
              </li>
            ))}
            {(listQuery.data ?? []).length === 0 ? (
              <li className="px-3 py-6 text-center text-sm text-slate-500">
                Nenhum modelo cadastrado. Clique em “Novo modelo”.
              </li>
            ) : null}
          </ul>
        )}

        {draft ? (
          <div className="space-y-3">
            <ol className="grid gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-700 sm:grid-cols-3">
              <li>
                <span className="font-semibold text-slate-900">1. SVG da faca</span>
                <span className="mt-0.5 block text-slate-500">
                  Contrato Sagra: camadas corte (#ED3237) e dobras (#00AFEF); path
                  id=corte_perimetro (fechado, com curvas); ids nas dobras. Opcional:
                  camada paineis.
                </span>
              </li>
              <li>
                <span className="font-semibold text-slate-900">2. Base</span>
                <span className="mt-0.5 block text-slate-500">
                  Clique no painel que fica parado (azul ★).
                </span>
              </li>
              <li>
                <span className="font-semibold text-slate-900">3. Sequência</span>
                <span className="mt-0.5 block text-slate-500">
                  Adicione dobras; “Mesmo passo” faz várias dobrarem juntas.
                </span>
              </li>
            </ol>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-xs text-slate-600">
                Nome
                <input
                  className="mt-1 w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm"
                  value={draft.nome}
                  onChange={(e) =>
                    setDraft((d) => (d ? { ...d, nome: e.target.value } : d))
                  }
                />
              </label>
              <label className="text-xs text-slate-600">
                Dica (aparece na Prova)
                <input
                  className="mt-1 w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm"
                  value={draft.hint}
                  onChange={(e) =>
                    setDraft((d) => (d ? { ...d, hint: e.target.value } : d))
                  }
                />
              </label>
            </div>

            <label className="block text-xs text-slate-600">
              SVG da faca
              <span className="mt-0.5 block font-normal text-slate-500">
                Contrato Sagra: mm no width/height; camada “corte” #ED3237 + path
                id=&quot;corte_perimetro&quot; (fechado); camada “dobras” #00AFEF com ids;
                sem dobra no vão. Opcional: camada “paineis” (data-sagra=panel).
              </span>
              <input
                type="file"
                accept="image/svg+xml,.svg"
                className="mt-1 block w-full text-xs"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) parseMut.mutate(f);
                }}
              />
            </label>
            {parseMut.isPending ? (
              <p className="text-xs text-slate-500">Lendo SVG e montando painéis…</p>
            ) : null}

            {draft.config ? (
              <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(320px,400px)]">
                <div className="space-y-3">
                  <BoxModelDielineEditor
                    config={draft.config}
                    selectedPanelId={selectedPanelId}
                    selectedEdgeId={selectedEdgeId}
                    focusPointMm={focusPointMm}
                    onSelectPanel={(id) => {
                      setSelectedPanelId(id);
                      setSelectedEdgeId(null);
                      setSelectedHingeId(null);
                    }}
                    onSelectEdge={(id) => {
                      setSelectedEdgeId(id);
                      setSelectedPanelId(null);
                      const edge = (draft.config?.edges ?? []).find(
                        (e) => e.id === id,
                      );
                      setSelectedHingeId(edge?.hingeId ?? null);
                    }}
                  />

                  {parseWarnings.length > 0 ? (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-950">
                      <p className="mb-1.5 font-semibold">
                        Avisos da importação ({parseWarnings.length})
                      </p>
                      <ul className="space-y-1">
                        {parseWarnings.map((w, i) => (
                          <li key={`${w.code}-${i}`}>
                            <button
                              type="button"
                              className="text-left underline-offset-2 hover:underline"
                              onClick={() => {
                                if (w.pointMm && w.pointMm.length >= 2) {
                                  setFocusPointMm(w.pointMm);
                                }
                              }}
                            >
                              <span className="font-mono text-[10px] text-amber-700">
                                {w.code}
                              </span>
                              {" — "}
                              {w.message}
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs">
                    {selectedEdge ? (
                      <div className="space-y-2">
                        <p className="font-semibold text-slate-700">
                          {selectedEdge.kind === "fold"
                            ? "Dobra selecionada"
                            : "Corte (não entra na sequência)"}
                        </p>
                        <p className="text-[11px] text-slate-500">
                          {selectedEdge.kind === "fold"
                            ? "Linha pontilhada do SVG"
                            : "Linha contínua do SVG"}
                          {selectedEdge.hingeId
                            ? ` · junta ${selectedEdge.hingeId}`
                            : ""}
                        </p>
                        {selectedEdge.kind === "fold" && selectedEdge.hingeId ? (
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              disabled={alreadyInSequence}
                              className="inline-flex items-center gap-1 rounded-lg bg-primary-green px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                              onClick={() => {
                                if (!selectedEdge.hingeId) return;
                                patchConfig((c) =>
                                  addHingeToSequence(c, selectedEdge.hingeId!),
                                );
                              }}
                            >
                              <Plus className="size-3.5" aria-hidden />
                              {alreadyInSequence
                                ? "Já está na sequência"
                                : "Novo passo"}
                            </button>
                            <button
                              type="button"
                              disabled={
                                alreadyInSequence ||
                                (draft.config?.operations?.length ?? 0) === 0
                              }
                              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 disabled:opacity-50"
                              onClick={() => {
                                if (!selectedEdge.hingeId || !draft.config)
                                  return;
                                const last = Math.max(
                                  0,
                                  ...draft.config.operations.map((o) => o.order),
                                );
                                patchConfig((c) =>
                                  addHingeToSequence(c, selectedEdge.hingeId!, {
                                    sameStepAs: last || 1,
                                  }),
                                );
                              }}
                            >
                              Mesmo passo
                            </button>
                          </div>
                        ) : selectedEdge.kind === "fold" && !selectedEdge.hingeId ? (
                          <p className="text-[11px] text-amber-800">
                            Esta dobra não une dois painéis detectados — não entra
                            na montagem 3D.
                          </p>
                        ) : (
                          <p className="text-[11px] text-slate-500">
                            Selecione uma linha pontilhada (dobra) para incluir na
                            sequência.
                          </p>
                        )}
                      </div>
                    ) : selectedPanel ? (
                      <div className="space-y-2">
                        <p className="font-semibold text-slate-700">
                          Painel selecionado
                        </p>
                        <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                          <label className="block text-slate-600">
                            Rótulo
                            <input
                              className="mt-1 w-full rounded border border-slate-200 px-2 py-1"
                              value={selectedPanel.label ?? ""}
                              onChange={(e) => {
                                const v = e.target.value;
                                patchConfig((c) => ({
                                  ...c,
                                  panels: c.panels.map((p) =>
                                    p.id === selectedPanelId
                                      ? { ...p, label: v }
                                      : p,
                                  ),
                                }));
                              }}
                            />
                          </label>
                          <div className="flex items-end">
                            <button
                              type="button"
                              className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
                                draft.config.basePanelId === selectedPanelId
                                  ? "bg-blue-600 text-white"
                                  : "border border-slate-200 bg-white text-slate-700"
                              }`}
                              onClick={() => {
                                if (!selectedPanelId) return;
                                patchConfig((c) =>
                                  withBasePanel(c, selectedPanelId),
                                );
                              }}
                            >
                              {draft.config.basePanelId === selectedPanelId
                                ? "É o painel base ★"
                                : "Definir como base"}
                            </button>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <p className="text-slate-500">
                        Clique em um painel (base) ou numa dobra pontilhada.
                      </p>
                    )}
                  </div>

                  <BoxModelPreview3D config={draft.config} />
                </div>

                <BoxModelOperationsList
                  config={draft.config}
                  selectedHingeId={activeHingeId}
                  onSelectHinge={(hingeId) => {
                    setSelectedHingeId(hingeId);
                    const edge = (draft.config?.edges ?? []).find(
                      (e) => e.hingeId === hingeId,
                    );
                    setSelectedEdgeId(edge?.id ?? null);
                    setSelectedPanelId(null);
                  }}
                  onChange={(next) =>
                    setDraft((d) => (d ? { ...d, config: next } : d))
                  }
                />
              </div>
            ) : (
              <p className="text-sm text-slate-500">
                Envie o SVG da faca para detectar cortes, dobras e painéis.
              </p>
            )}

            {error ? <p className="text-sm text-red-600">{error}</p> : null}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs"
                onClick={() => setDraft(null)}
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={saveMut.isPending || !draft.config}
                className="rounded-lg bg-primary-green px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                onClick={() => saveMut.mutate()}
              >
                {saveMut.isPending ? "Salvando…" : "Salvar modelo"}
              </button>
            </div>
          </div>
        ) : null}
      </ConfigSectionBody>
    </ConfigSection>
  );
}
