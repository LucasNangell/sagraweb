import { useQuery } from "@tanstack/react-query";
import { cn } from "@sagra/ui";
import {
  Box,
  ChevronDown,
  FileText,
  Layers,
  LayoutGrid,
  Loader2,
  Package,
  Plus,
  Printer,
  Search,
  Tag,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { fetchPapelariaAdminModelos } from "@/api/adminSystem";
import { fetchImposicaoStatus } from "@/api/imposicaoPerfil";
import {
  groupPapelariaModelosByProduto,
  type PapelariaProdutoGroup,
} from "@/features/configuracoes/groupPapelariaModelosByProduto";
import type { PapelariaAdminModelRecord } from "@/features/configuracoes/types";

import { PapelariaModeloDadosPanel } from "./PapelariaModeloDadosPanel";
import { PapelariaModelosPorFace, type Face } from "./PapelariaModelosPorFace";
import { PapelariaModeloTextosPanel } from "./PapelariaModeloTextosPanel";
import { PapelariaProdutoMockupPanel } from "./PapelariaProdutoMockupPanel";
import { PapelariaNovoModeloForm } from "./PapelariaNovoModeloForm";
import {
  EmptyState,
  normalizeSearch,
  SegmentedControl,
  StatusPill,
} from "./PapelariaWorkspaceUi";
import { PerfilImposicaoPanel } from "./PerfilImposicaoPanel";

type ModeloTab = "dados" | "textos";
type Scope = "modelos" | "mockup" | "imposicao";
type WorkspaceMode = "browse" | "new-model" | "new-product";

type ImposicaoStatus = Partial<
  Record<"digital" | "offset", { existe: boolean; ativo: boolean }>
>;

const MODELO_TABS: { id: ModeloTab; label: string; icon: typeof Tag; hint: string }[] = [
  { id: "dados", label: "Dados gerais", icon: Tag, hint: "Nome, pasta de imposição e PDF de prova por e-mail" },
  {
    id: "textos",
    label: "Textos e prévia",
    icon: FileText,
    hint: "PDF do modelo: textos ligados aos campos, Prova PDF e prévia ao vivo da Papelaria",
  },
];

/** Abas antigas (sessão salva) → aba unificada. */
function normalizarTab(tab: string | undefined): ModeloTab {
  if (tab === "dados" || tab === "textos") return tab;
  if (tab === "preview" || tab === "prova-pdf") return "textos";
  return "dados";
}

const STORAGE_KEY = "sagra:config:papelaria-produtos";

type StoredSelection = { produto?: string; modeloId?: number; tab?: string; scope?: Scope };

function readStored(): StoredSelection {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as StoredSelection) : {};
  } catch {
    return {};
  }
}

function modeloLabel(modelo: PapelariaAdminModelRecord): string {
  const parts = [modelo.frente_versao, modelo.cores].filter((p) => p?.trim());
  if (parts.length) return parts.join(" · ");
  return modelo.nome_exibicao || modelo.arquivo_modelo;
}

function plural(n: number, um: string, varios: string): string {
  return `${n} ${n === 1 ? um : varios}`;
}

export function PapelariaProdutosAdminSection() {
  const modelosQuery = useQuery({
    queryKey: ["admin", "papelaria-modelos"],
    queryFn: fetchPapelariaAdminModelos,
  });
  const imposicaoStatusQuery = useQuery({
    queryKey: ["admin", "imposicao-status"],
    queryFn: fetchImposicaoStatus,
    staleTime: 30_000,
  });

  const [stored] = useState(readStored);
  const [selectedProduto, setSelectedProduto] = useState<string | null>(stored.produto ?? null);
  const [selectedModeloId, setSelectedModeloId] = useState<number | null>(stored.modeloId ?? null);
  const [modeloTab, setModeloTab] = useState<ModeloTab>(() => normalizarTab(stored.tab));
  const [scope, setScope] = useState<Scope>(stored.scope ?? "modelos");
  const [mode, setMode] = useState<WorkspaceMode>("browse");
  /** Face do cadastro em «Nova frente» / «Novo verso». */
  const [novaFace, setNovaFace] = useState<Face>("frente");
  const [busca, setBusca] = useState("");
  const [navAberta, setNavAberta] = useState(false);

  const modelos = modelosQuery.data ?? [];
  const groups = useMemo(() => groupPapelariaModelosByProduto(modelos), [modelos]);
  const nomesProdutos = useMemo(() => groups.map((g) => g.produto), [groups]);

  const gruposFiltrados = useMemo(() => {
    const q = normalizeSearch(busca);
    if (!q) return groups;
    return groups.filter((g) =>
      [g.produto, ...g.modelos.flatMap((m) => [m.nome_exibicao, m.arquivo_modelo, m.cores, m.frente_versao])]
        .filter(Boolean)
        .some((t) => normalizeSearch(String(t)).includes(q)),
    );
  }, [groups, busca]);

  const selectedGroup = useMemo(
    () => groups.find((g) => g.produto === selectedProduto) ?? null,
    [groups, selectedProduto],
  );
  const selectedModelo = useMemo(
    () => selectedGroup?.modelos.find((m) => m.id === selectedModeloId) ?? null,
    [selectedGroup, selectedModeloId],
  );

  // Mantém uma seleção válida sempre que a lista muda (criação/exclusão/recarga).
  useEffect(() => {
    if (mode !== "browse") return;
    if (groups.length === 0) {
      if (!modelosQuery.isLoading) {
        setSelectedProduto(null);
        setSelectedModeloId(null);
      }
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
  }, [groups, mode, selectedProduto, selectedModeloId, modelosQuery.isLoading]);

  useEffect(() => {
    try {
      const payload: StoredSelection = {
        produto: selectedProduto ?? undefined,
        modeloId: selectedModeloId ?? undefined,
        tab: modeloTab,
        scope,
      };
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch {
      /* sessionStorage indisponível — ignora */
    }
  }, [selectedProduto, selectedModeloId, modeloTab, scope]);

  const selectProduto = (produto: string) => {
    setMode("browse");
    setNavAberta(false);
    if (produto === selectedProduto) return;
    setSelectedProduto(produto);
    const group = groups.find((g) => g.produto === produto);
    setSelectedModeloId(group?.modelos[0]?.id ?? null);
  };

  const handleCreated = (modelo: PapelariaAdminModelRecord) => {
    setSelectedProduto(modelo.produto);
    setSelectedModeloId(modelo.id);
    setScope("modelos");
    // Mockup é do produto; o passo seguinte do modelo é o PDF (textos e prévia).
    setModeloTab("textos");
    setMode("browse");
  };

  const handleDeleted = (modeloId: number) => {
    if (selectedModeloId === modeloId) {
      setSelectedModeloId(null);
    }
  };

  const totalModelos = modelos.length;
  const impStatus = imposicaoStatusQuery.data ?? {};

  return (
    <section className="pw-workspace config-section" aria-labelledby="pw-produtos-title">
      <header className="pw-workspace__header">
        <div className="flex min-w-0 items-center gap-3">
          <span className="pw-modo__icon" aria-hidden>
            <Package className="size-4" />
          </span>
          <div className="min-w-0">
            <h2 id="pw-produtos-title" className="text-sm font-bold text-slate-800">
              Produtos de papelaria
            </h2>
            <p className="text-xs text-slate-500">
              {modelosQuery.isLoading
                ? "Carregando catálogo…"
                : `${plural(groups.length, "produto", "produtos")} · ${plural(totalModelos, "modelo Corel", "modelos Corel")}`}
            </p>
          </div>
        </div>
        <button
          type="button"
          className="sagra-btn sagra-btn--add sagra-btn--sm"
          aria-pressed={mode === "new-product"}
          onClick={() => {
            setMode("new-product");
            setNavAberta(false);
          }}
        >
          <Plus className="size-3.5" aria-hidden />
          Novo produto
        </button>
      </header>

      <div className="pw-workspace__body">
        {/* Navegador de produtos */}
        <aside className={cn("pw-nav", navAberta && "is-open")} aria-label="Produtos">
          <button
            type="button"
            className="pw-nav__toggle"
            aria-expanded={navAberta}
            aria-controls="pw-nav-panel"
            onClick={() => setNavAberta((v) => !v)}
          >
            <span className="min-w-0 text-left">
              <span className="block text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                Produto
              </span>
              <span className="block truncate text-sm font-semibold text-slate-800">
                {mode === "new-product" ? "Novo produto" : (selectedProduto ?? "Selecione")}
              </span>
            </span>
            <ChevronDown
              className={cn("size-4 shrink-0 text-slate-500 transition-transform", navAberta && "rotate-180")}
              aria-hidden
            />
          </button>

          <div id="pw-nav-panel" className="pw-nav__panel">
            <div className="pw-nav__search">
              <Search className="pw-nav__search-icon size-3.5" aria-hidden />
              <input
                type="search"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar produto ou modelo…"
                aria-label="Buscar produto ou modelo"
                className="pw-input pw-input--search"
              />
              {busca ? (
                <button
                  type="button"
                  className="pw-nav__search-clear"
                  aria-label="Limpar busca"
                  onClick={() => setBusca("")}
                >
                  <X className="size-3.5" aria-hidden />
                </button>
              ) : null}
            </div>

            <div className="pw-nav__list pw-scroll">
              {modelosQuery.isLoading ? (
                <p className="flex items-center gap-2 px-3 py-4 text-xs text-slate-500">
                  <Loader2 className="size-3.5 animate-spin" aria-hidden />
                  Carregando produtos…
                </p>
              ) : modelosQuery.isError ? (
                <p className="px-3 py-4 text-xs text-red-600">
                  {(modelosQuery.error as Error).message || "Erro ao carregar produtos."}
                </p>
              ) : groups.length === 0 ? (
                <p className="px-3 py-4 text-xs text-slate-500">Nenhum produto cadastrado ainda.</p>
              ) : gruposFiltrados.length === 0 ? (
                <p className="px-3 py-4 text-xs text-slate-500">
                  Nada encontrado para “{busca}”.
                </p>
              ) : (
                <ul className="space-y-1 p-2">
                  {gruposFiltrados.map((g) => (
                    <li key={g.produto}>
                      <ProdutoNavItem
                        group={g}
                        status={impStatus[g.produto]}
                        active={mode === "browse" && g.produto === selectedProduto}
                        onSelect={() => selectProduto(g.produto)}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </aside>

        {/* Área de trabalho */}
        <div className="pw-main">
          {mode === "new-product" ? (
            <PapelariaNovoModeloForm
              produtosExistentes={nomesProdutos}
              onCreated={handleCreated}
              onCancel={() => setMode("browse")}
            />
          ) : mode === "new-model" && selectedProduto ? (
            <PapelariaNovoModeloForm
              key={`novo-${novaFace}`}
              lockedProduto={selectedProduto}
              faceInicial={novaFace}
              onCreated={handleCreated}
              onCancel={() => setMode("browse")}
            />
          ) : !selectedGroup ? (
            <EmptyState
              className="flex-1"
              icon={modelosQuery.isLoading ? <Loader2 className="size-6 animate-spin" /> : <Printer className="size-6" />}
              title={modelosQuery.isLoading ? "Carregando…" : "Comece cadastrando um produto"}
              action={
                modelosQuery.isLoading ? null : (
                  <button
                    type="button"
                    className="sagra-btn sagra-btn--add sagra-btn--sm"
                    onClick={() => setMode("new-product")}
                  >
                    <Plus className="size-3.5" aria-hidden /> Novo produto
                  </button>
                )
              }
            >
              {modelosQuery.isLoading
                ? null
                : "Envie o template CorelDRAW (.cdr) e o sistema cria o modelo com mockup e prévia iniciais."}
            </EmptyState>
          ) : (
            <>
              <ProdutoHeader
                group={selectedGroup}
                status={impStatus[selectedGroup.produto]}
                scope={scope}
                onScopeChange={setScope}
              />

              {scope === "mockup" ? (
                <div className="pw-panel-host">
                  <PapelariaProdutoMockupPanel
                    key={selectedGroup.produto}
                    produto={selectedGroup.produto}
                    modelos={selectedGroup.modelos}
                  />
                </div>
              ) : scope === "imposicao" ? (
                <div className="pw-panel-host">
                  {selectedGroup.modelos.length > 1 ? (
                    <div className="pw-imposicao-ref">
                      <label htmlFor="pw-imp-modelo" className="text-[11px] font-medium text-slate-600">
                        Modelo de referência para a configuração antiga
                      </label>
                      <select
                        id="pw-imp-modelo"
                        className="pw-input pw-input--sm max-w-xs"
                        value={selectedModeloId ?? ""}
                        onChange={(e) => setSelectedModeloId(Number(e.target.value))}
                      >
                        {selectedGroup.modelos.map((m) => (
                          <option key={m.id} value={m.id}>
                            {modeloLabel(m)}
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : null}
                  <PerfilImposicaoPanel
                    key={selectedGroup.produto}
                    produto={selectedGroup.produto}
                    modelo={selectedModelo}
                    produtos={nomesProdutos}
                  />
                </div>
              ) : (
                <>
                  <PapelariaModelosPorFace
                    modelos={selectedGroup.modelos}
                    selectedId={selectedModeloId}
                    onSelect={setSelectedModeloId}
                    onNovo={(face) => {
                      setNovaFace(face);
                      setMode("new-model");
                    }}
                    onModeloExcluido={handleDeleted}
                  />

                  {!selectedModelo ? (
                    <EmptyState className="flex-1" icon={<Layers className="size-6" />} title="Selecione um modelo">
                      Escolha uma frente ou um verso acima, ou cadastre um novo.
                    </EmptyState>
                  ) : (
                    <>
                      <ModeloTabs
                        modelo={selectedModelo}
                        active={modeloTab}
                        onChange={setModeloTab}
                      />
                      <div
                        className="pw-panel-host"
                        role="tabpanel"
                        id={`pw-modelo-panel-${modeloTab}`}
                        aria-labelledby={`pw-modelo-tab-${modeloTab}`}
                      >
                        {modeloTab === "dados" ? (
                          <PapelariaModeloDadosPanel
                            key={selectedModelo.id}
                            modelo={selectedModelo}
                            onDeleted={handleDeleted}
                          />
                        ) : null}
                        {modeloTab === "textos" ? (
                          <PapelariaModeloTextosPanel key={selectedModelo.id} modelo={selectedModelo} />
                        ) : null}
                      </div>
                    </>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------------ */

function ProdutoNavItem({
  group,
  status,
  active,
  onSelect,
}: {
  group: PapelariaProdutoGroup;
  status?: ImposicaoStatus;
  active: boolean;
  onSelect: () => void;
}) {
  const total = group.modelos.length;
  return (
    <button
      type="button"
      className={cn("pw-nav-item", active && "is-active")}
      aria-current={active ? "true" : undefined}
      onClick={onSelect}
    >
      <span className="flex items-start justify-between gap-2">
        <span className="pw-nav-item__name">{group.produto}</span>
        <span className="pw-nav-item__count" title={plural(total, "modelo", "modelos")}>
          {total}
        </span>
      </span>
      <span className="pw-nav-item__meta">
        <span
          className={cn("pw-coverage", !mockupDoProduto(group) && "is-none", mockupDoProduto(group) && "is-full")}
          title={mockupDoProduto(group) ? "Mockup 3D configurado no produto" : "Mockup 3D automático"}
        >
          <Box className="size-3" aria-hidden />
          {mockupDoProduto(group) ? "✓" : "—"}
        </span>
        <Coverage icon={<FileText className="size-3" aria-hidden />} n={group.comProvaPdf} total={total} label="PDF do modelo" />
        <ImposicaoBadges status={status} />
      </span>
    </button>
  );
}

function Coverage({ icon, n, total, label }: { icon: ReactNode; n: number; total: number; label: string }) {
  const full = total > 0 && n === total;
  return (
    <span
      className={cn("pw-coverage", n === 0 && "is-none", full && "is-full")}
      title={`${n} de ${total} com ${label}`}
    >
      {icon}
      {n}/{total}
    </span>
  );
}

function ImposicaoBadges({ status, detailed = false }: { status?: ImposicaoStatus; detailed?: boolean }) {
  if (!status) return null;
  const items = (["digital", "offset"] as const).filter((v) => status[v]?.existe);
  if (!items.length) return null;
  return (
    <span className="inline-flex flex-wrap gap-1">
      {items.map((v) => {
        const ativo = Boolean(status[v]?.ativo);
        const nome = v === "digital" ? "Digital" : "Offset";
        return (
          <StatusPill
            key={v}
            tone={ativo ? "ok" : "warn"}
            title={`Imposição ${nome}: ${ativo ? "perfil em uso" : "rascunho"}`}
          >
            {detailed ? `${nome} · ${ativo ? "em uso" : "rascunho"}` : nome.charAt(0)}
          </StatusPill>
        );
      })}
    </span>
  );
}

function ProdutoHeader({
  group,
  status,
  scope,
  onScopeChange,
}: {
  group: PapelariaProdutoGroup;
  status?: ImposicaoStatus;
  scope: Scope;
  onScopeChange: (s: Scope) => void;
}) {
  return (
    <div className="pw-produto-header">
      <div className="min-w-0 flex-1">
        <h3 className="truncate text-base font-bold text-slate-800" title={group.produto}>
          {group.produto}
        </h3>
        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
          <span>{plural(group.modelos.length, "modelo", "modelos")}</span>
          <span aria-hidden>·</span>
          <span>{mockupDoProduto(group) ? "mockup do produto configurado" : "mockup automático"}</span>
          <span aria-hidden>·</span>
          <span>{group.comProvaPdf} com PDF do modelo</span>
          <ImposicaoBadges status={status} detailed />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <SegmentedControl<Scope>
          ariaLabel="Escopo da configuração"
          size="sm"
          value={scope}
          onChange={onScopeChange}
          options={[
            {
              id: "modelos",
              label: "Modelos",
              icon: <Layers className="size-3.5 shrink-0" aria-hidden />,
              title: "Configurações de cada modelo Corel (variação)",
            },
            {
              id: "mockup",
              label: "Mockup 3D",
              icon: <Box className="size-3.5 shrink-0" aria-hidden />,
              title: "Mockup 3D do produto (só frente / frente e verso) — vale para todos os modelos",
            },
            {
              id: "imposicao",
              label: "Imposição",
              icon: <LayoutGrid className="size-3.5 shrink-0" aria-hidden />,
              title: "Perfil de imposição Digital/Offset — vale para todo o produto",
            },
          ]}
        />

      </div>
    </div>
  );
}


function mockupDoProduto(group: PapelariaProdutoGroup): boolean {
  const mp = group.modelos[0]?.mockup_produto;
  return Boolean(mp?.frente?.trim() || mp?.frente_verso?.trim());
}

function ModeloTabs({
  modelo,
  active,
  onChange,
}: {
  modelo: PapelariaAdminModelRecord;
  active: ModeloTab;
  onChange: (t: ModeloTab) => void;
}) {
  const badge = (id: ModeloTab): ReactNode => {
    if (id === "textos") {
      if (modelo.tem_prova_pdf) return <span className="pw-tab__dot is-on" title="PDF do modelo em uso" />;
      return modelo.tem_preview_config ? (
        <span className="pw-tab__dot" title="Prévia por imagem (legado) — envie o PDF do modelo" />
      ) : (
        <span className="pw-tab__dot is-warn" title="Sem prévia configurada" />
      );
    }
    return null;
  };

  return (
    <div className="pw-tabs pw-scroll" role="tablist" aria-label={`Configuração do modelo ${modeloLabel(modelo)}`}>
      {MODELO_TABS.map((tab) => {
        const Icon = tab.icon;
        const isActive = active === tab.id;
        return (
          <button
            key={tab.id}
            id={`pw-modelo-tab-${tab.id}`}
            type="button"
            role="tab"
            aria-selected={isActive}
            aria-controls={`pw-modelo-panel-${tab.id}`}
            title={tab.hint}
            className={cn("pw-tab", isActive && "is-active")}
            onClick={() => onChange(tab.id)}
          >
            <Icon className="size-3.5 shrink-0" aria-hidden />
            {tab.label}
            {badge(tab.id)}
          </button>
        );
      })}
    </div>
  );
}
