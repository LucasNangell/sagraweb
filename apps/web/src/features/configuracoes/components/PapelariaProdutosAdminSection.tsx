import { useQuery } from "@tanstack/react-query";
import { cn } from "@sagra/ui";
import { Box, Eye, Loader2, Plus, Printer, Tag } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { fetchPapelariaAdminModelos } from "@/api/adminSystem";
import { groupPapelariaModelosByProduto } from "@/features/configuracoes/groupPapelariaModelosByProduto";
import type { PapelariaAdminModelRecord } from "@/features/configuracoes/types";

import {
  ConfigLoadingState,
  ConfigSection,
  ConfigSectionBody,
  ConfigSectionHeader,
} from "./ConfigSectionLayout";
import { PapelariaModeloDadosPanel } from "./PapelariaModeloDadosPanel";
import { PapelariaModeloMockupPanel } from "./PapelariaModeloMockupPanel";
import { PapelariaModeloPreviewPanel } from "./PapelariaModeloPreviewPanel";
import { PapelariaNovoModeloForm } from "./PapelariaNovoModeloForm";

type InnerTab = "dados" | "mockup" | "preview";
type WorkspaceMode = "browse" | "new-model" | "new-product";

const INNER_TABS: { id: InnerTab; label: string; icon: typeof Tag }[] = [
  { id: "dados", label: "Dados", icon: Tag },
  { id: "mockup", label: "Mockup 3D", icon: Box },
  { id: "preview", label: "Prévia", icon: Eye },
];

function modeloChipLabel(modelo: PapelariaAdminModelRecord): string {
  const parts = [modelo.frente_versao, modelo.cores].filter((p) => p?.trim());
  if (parts.length) return parts.join(" · ");
  return modelo.nome_exibicao || modelo.arquivo_modelo;
}

export function PapelariaProdutosAdminSection() {
  const modelosQuery = useQuery({
    queryKey: ["admin", "papelaria-modelos"],
    queryFn: fetchPapelariaAdminModelos,
  });

  const [selectedProduto, setSelectedProduto] = useState<string | null>(null);
  const [selectedModeloId, setSelectedModeloId] = useState<number | null>(null);
  const [innerTab, setInnerTab] = useState<InnerTab>("dados");
  const [mode, setMode] = useState<WorkspaceMode>("browse");

  const modelos = modelosQuery.data ?? [];
  const groups = useMemo(() => groupPapelariaModelosByProduto(modelos), [modelos]);

  const selectedGroup = useMemo(
    () => groups.find((g) => g.produto === selectedProduto) ?? null,
    [groups, selectedProduto],
  );
  const selectedModelo = useMemo(
    () => selectedGroup?.modelos.find((m) => m.id === selectedModeloId) ?? null,
    [selectedGroup, selectedModeloId],
  );

  useEffect(() => {
    if (mode !== "browse") return;
    if (groups.length === 0) {
      setSelectedProduto(null);
      setSelectedModeloId(null);
      return;
    }
    const group = groups.find((g) => g.produto === selectedProduto) ?? groups[0];
    if (group.produto !== selectedProduto) {
      setSelectedProduto(group.produto);
    }
    const stillSelected = group.modelos.some((m) => m.id === selectedModeloId);
    if (!stillSelected) {
      setSelectedModeloId(group.modelos[0]?.id ?? null);
    }
  }, [groups, mode, selectedProduto, selectedModeloId]);

  const selectProduto = (produto: string) => {
    setMode("browse");
    setSelectedProduto(produto);
    const group = groups.find((g) => g.produto === produto);
    setSelectedModeloId(group?.modelos[0]?.id ?? null);
  };

  const handleCreated = (modelo: PapelariaAdminModelRecord) => {
    setSelectedProduto(modelo.produto);
    setSelectedModeloId(modelo.id);
    setInnerTab("mockup");
    setMode("browse");
  };

  const handleDeleted = (modeloId: number) => {
    if (selectedModeloId === modeloId) {
      setSelectedModeloId(null);
    }
  };

  return (
    <ConfigSection variant="papelaria">
      <ConfigSectionHeader
        title="Produtos de papelaria"
        description="Selecione um produto para configurar seus modelos Corel, o mockup 3D e a prévia em tempo real de cada variação."
        icon={<Printer className="size-4" aria-hidden />}
      />

      <ConfigSectionBody noPadding className="papelaria-produtos-layout min-h-0 flex-1">
        <div className="papelaria-produtos-sidebar">
          <p className="shrink-0 border-b border-slate-200 bg-slate-50 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            Produtos ({groups.length})
          </p>
          <div className="papelaria-admin-model-list">
            {modelosQuery.isLoading ? (
              <ConfigLoadingState className="px-3 py-4 text-xs">
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
                Carregando produtos…
              </ConfigLoadingState>
            ) : groups.length === 0 ? (
              <p className="p-3 text-xs text-slate-500">
                Nenhum produto cadastrado. Crie o primeiro à direita.
              </p>
            ) : (
              <ul>
                {groups.map((g) => {
                  const active = mode === "browse" && g.produto === selectedProduto;
                  return (
                    <li key={g.produto}>
                      <button
                        type="button"
                        className={cn(
                          "w-full border-b border-slate-100 px-3 py-2 text-left text-xs transition hover:bg-slate-50",
                          active && "bg-secondary-blue/5",
                        )}
                        onClick={() => selectProduto(g.produto)}
                      >
                        <span className="font-medium text-slate-800">{g.produto}</span>
                        <span className="mt-0.5 block text-[10px] text-slate-500">
                          {g.modelos.length} modelo{g.modelos.length === 1 ? "" : "s"}
                          {g.comMockup > 0 ? ` · ${g.comMockup} mockup` : ""}
                          {g.comPreview > 0 ? ` · ${g.comPreview} prévia` : ""}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          <div className="shrink-0 border-t border-slate-200 p-2">
            <button
              type="button"
              className={cn(
                "inline-flex w-full items-center justify-center gap-1.5 rounded px-3 py-1.5 text-xs font-semibold",
                mode === "new-product"
                  ? "bg-secondary-blue text-white"
                  : "border border-slate-300 text-slate-700 hover:bg-slate-50",
              )}
              onClick={() => setMode("new-product")}
            >
              <Plus className="size-3.5" aria-hidden />
              Novo produto
            </button>
          </div>
        </div>

        <div className="papelaria-produtos-detail">
          {mode === "new-product" ? (
            <PapelariaNovoModeloForm
              onCreated={handleCreated}
              onCancel={() => setMode("browse")}
            />
          ) : mode === "new-model" && selectedProduto ? (
            <PapelariaNovoModeloForm
              lockedProduto={selectedProduto}
              onCreated={handleCreated}
              onCancel={() => setMode("browse")}
            />
          ) : !selectedGroup ? (
            <div className="flex flex-1 items-center justify-center p-6 text-xs text-slate-500">
              {modelosQuery.isLoading
                ? "Carregando…"
                : "Crie um produto para começar o cadastro de modelos."}
            </div>
          ) : (
            <>
              <div className="shrink-0 border-b border-slate-200 px-4 py-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-bold text-slate-800">{selectedGroup.produto}</h3>
                    <p className="mt-0.5 text-[11px] text-slate-500">
                      {selectedGroup.modelos.length} modelo
                      {selectedGroup.modelos.length === 1 ? "" : "s"} neste produto
                    </p>
                  </div>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1.5 rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                    onClick={() => setMode("new-model")}
                  >
                    <Plus className="size-3.5" aria-hidden />
                    Novo modelo
                  </button>
                </div>
                <div className="papelaria-modelo-chips mt-3">
                  {selectedGroup.modelos.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      className={cn(
                        "inline-flex max-w-full items-center gap-1.5 rounded-md px-2.5 py-1.5 text-left text-[11px] font-semibold transition",
                        selectedModeloId === m.id
                          ? "bg-white text-secondary-blue shadow-sm ring-1 ring-slate-200/80"
                          : "bg-slate-100 text-slate-600 hover:bg-white/80 hover:text-secondary-blue",
                      )}
                      onClick={() => setSelectedModeloId(m.id)}
                    >
                      <span className="truncate">{modeloChipLabel(m)}</span>
                      {m.tem_mockup_config ? (
                        <span className="size-1.5 shrink-0 rounded-full bg-emerald-500" title="Mockup custom" />
                      ) : null}
                      {m.tem_preview_config ? (
                        <span className="size-1.5 shrink-0 rounded-full bg-sky-500" title="Prévia configurada" />
                      ) : null}
                    </button>
                  ))}
                </div>
              </div>

              {!selectedModelo ? (
                <div className="flex flex-1 items-center justify-center p-6 text-xs text-slate-500">
                  Selecione um modelo ou crie um novo.
                </div>
              ) : (
                <>
                  <div
                    className="configuracoes-tab-list mx-4 mt-3 shrink-0"
                    role="tablist"
                    aria-label="Configuração do modelo"
                  >
                    {INNER_TABS.map((tab) => {
                      const Icon = tab.icon;
                      const active = innerTab === tab.id;
                      return (
                        <button
                          key={tab.id}
                          type="button"
                          role="tab"
                          aria-selected={active}
                          className={cn(
                            "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors",
                            active
                              ? "bg-white text-secondary-blue shadow-sm ring-1 ring-slate-200/80"
                              : "text-slate-600 hover:bg-white/60 hover:text-secondary-blue",
                          )}
                          onClick={() => setInnerTab(tab.id)}
                        >
                          <Icon className="size-3.5" aria-hidden />
                          {tab.label}
                        </button>
                      );
                    })}
                  </div>

                  <div className="flex min-h-0 flex-1 flex-col">
                    {innerTab === "dados" ? (
                      <PapelariaModeloDadosPanel
                        key={selectedModelo.id}
                        modelo={selectedModelo}
                        onDeleted={handleDeleted}
                      />
                    ) : null}
                    {innerTab === "mockup" ? (
                      <PapelariaModeloMockupPanel
                        key={selectedModelo.id}
                        modelo={selectedModelo}
                      />
                    ) : null}
                    {innerTab === "preview" ? (
                      <PapelariaModeloPreviewPanel
                        key={selectedModelo.id}
                        modelo={selectedModelo}
                      />
                    ) : null}
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </ConfigSectionBody>
    </ConfigSection>
  );
}
