import { useQuery } from "@tanstack/react-query";
import { cn } from "@sagra/ui";
import {
  Box,
  ChevronDown,
  Eye,
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
import { PapelariaModeloMockupPanel } from "./PapelariaModeloMockupPanel";
import { PapelariaModeloPreviewPanel } from "./PapelariaModeloPreviewPanel";
import { PapelariaModeloProvaPdfPanel } from "./PapelariaModeloProvaPdfPanel";
import { PapelariaNovoModeloForm } from "./PapelariaNovoModeloForm";
import {
  EmptyState,
  normalizeSearch,
  SegmentedControl,
  StatusPill,
} from "./PapelariaWorkspaceUi";
import { PerfilImposicaoPanel } from "./PerfilImposicaoPanel";

type ModeloTab = "dados" | "mockup" | "preview" | "prova-pdf";
type Scope = "modelos" | "imposicao";
type WorkspaceMode = "browse" | "new-model" | "new-product";

type ImposicaoStatus = Partial<
  Record<"digital" | "offset", { existe: boolean; ativo: boolean }>
>;

const MODELO_TABS: { id: ModeloTab; label: string; icon: typeof Tag; hint: string }[] = [
  { id: "dados", label: "Dados gerais", icon: Tag, hint: "Nome, pasta de imposição e PDF de prova por e-mail" },
  { id: "mockup", label: "Mockup 3D", icon: Box, hint: "Dobras, formato e visualização 3D da prova" },
  { id: "preview", label: "Prévia ao vivo", icon: Eye, hint: "Imagem base e campos da prévia em tempo real" },
  { id: "prova-pdf", label: "Prova PDF", icon: FileText, hint: "PDF do modelo e ligação dos textos aos campos" },
];

const STORAGE_KEY = "sagra:config:papelaria-produtos";

type StoredSelection = { produto?: string; modeloId?: number; tab?: ModeloTab; scope?: Scope };

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

function fileName(path: string): string {
  return path.replace(/\\/g, "/").split("/").pop() || path;
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
  const [modeloTab, setModeloTab] = useState<ModeloTab>(stored.tab ?? "dados");
  const [scope, setScope] = useState<Scope>(stored.scope ?? "modelos");
  const [mode, setMode] = useState<WorkspaceMode>("browse");
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
    setModeloTab("mockup");
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
              lockedProduto={selectedProduto}
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
                onNovoModelo={() => setMode("new-model")}
              />

              {scope === "imposicao" ? (
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
                  <ModeloStrip
                    modelos={selectedGroup.modelos}
                    selectedId={selectedModeloId}
                    onSelect={setSelectedModeloId}
                  />

                  {!selectedModelo ? (
                    <EmptyState className="flex-1" icon={<Layers className="size-6" />} title="Selecione um modelo">
                      Escolha uma variação acima ou crie um novo modelo para este produto.
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
                        {modeloTab === "mockup" ? (
                          <PapelariaModeloMockupPanel key={selectedModelo.id} modelo={selectedModelo} />
                        ) : null}
                        {modeloTab === "preview" ? (
                          <PapelariaModeloPreviewPanel key={selectedModelo.id} modelo={selectedModelo} />
                        ) : null}
                        {modeloTab === "prova-pdf" ? (
                          <PapelariaModeloProvaPdfPanel key={selectedModelo.id} modelo={selectedModelo} />
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
        <Coverage icon={<Box className="size-3" aria-hidden />} n={group.comMockup} total={total} label="mockup custom" />
        <Coverage icon={<Eye className="size-3" aria-hidden />} n={group.comPreview} total={total} label="prévia configurada" />
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
  onNovoModelo,
}: {
  group: PapelariaProdutoGroup;
  status?: ImposicaoStatus;
  scope: Scope;
  onScopeChange: (s: Scope) => void;
  onNovoModelo: () => void;
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
          <span>{group.comMockup} com mockup custom</span>
          <span aria-hidden>·</span>
          <span>{group.comPreview} com prévia</span>
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
              id: "imposicao",
              label: "Imposição",
              icon: <LayoutGrid className="size-3.5 shrink-0" aria-hidden />,
              title: "Perfil de imposição Digital/Offset — vale para todo o produto",
            },
          ]}
        />
        <button type="button" className="sagra-btn sagra-btn--outline sagra-btn--sm" onClick={onNovoModelo}>
          <Plus className="size-3.5" aria-hidden />
          Novo modelo
        </button>
      </div>
    </div>
  );
}

function ModeloStrip({
  modelos,
  selectedId,
  onSelect,
}: {
  modelos: PapelariaAdminModelRecord[];
  selectedId: number | null;
  onSelect: (id: number) => void;
}) {
  return (
    <div className="pw-modelos" role="group" aria-label="Modelos do produto">
      <ul className="pw-modelos__list pw-scroll">
        {modelos.map((m) => {
          const active = m.id === selectedId;
          return (
            <li key={m.id}>
              <button
                type="button"
                className={cn("pw-modelo-card", active && "is-active")}
                aria-pressed={active}
                onClick={() => onSelect(m.id)}
                title={m.nome_exibicao || m.arquivo_modelo}
              >
                <span className="pw-modelo-card__label">{modeloLabel(m)}</span>
                <span className="pw-modelo-card__file">{fileName(m.arquivo_modelo)}</span>
                <span className="pw-modelo-card__flags">
                  <Flag on={Boolean(m.tem_mockup_config)} label="Mockup" />
                  <Flag on={Boolean(m.tem_preview_config)} label="Prévia" />
                  {m.tem_imposicao_config ? <Flag on label="Imp. antiga" tone="violet" /> : null}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Flag({ on, label, tone }: { on: boolean; label: string; tone?: "violet" }) {
  return (
    <span
      className={cn("pw-flag", on ? (tone === "violet" ? "is-violet" : "is-on") : "is-off")}
      title={`${label}: ${on ? "configurado" : "padrão automático"}`}
    >
      <span className="pw-flag__dot" aria-hidden />
      {label}
    </span>
  );
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
    if (id === "mockup") {
      return modelo.tem_mockup_config ? (
        <span className="pw-tab__dot is-on" title="Mockup personalizado" />
      ) : (
        <span className="pw-tab__dot" title="Preset automático" />
      );
    }
    if (id === "preview") {
      return modelo.tem_preview_config ? (
        <span className="pw-tab__dot is-on" title="Prévia configurada" />
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
