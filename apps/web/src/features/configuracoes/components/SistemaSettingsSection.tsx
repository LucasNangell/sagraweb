import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { cn } from "@sagra/ui";
import {
  Building2,
  ChevronDown,
  ChevronRight,
  Layers,
  Loader2,
  Package,
  Palette,
  Plus,
  Printer,
  Ruler,
  Scissors,
  Search,
  Tag,
  ToggleLeft,
  ToggleRight,
  Trash2,
  Users,
  Workflow,
} from "lucide-react";
import { useMemo, useState, useEffect, type ReactNode } from "react";

import {
  activateSystemCatalogByLabel,
  activateSystemCatalogItem,
  createSystemCatalogItem,
  deactivateSystemCatalogByLabel,
  deactivateSystemCatalogItem,
  deleteSystemCatalogItem,
  fetchSystemCatalogCategories,
  fetchSystemCatalogItems,
  fetchAcabamentoVariacoes,
  createAcabamentoVariacao,
  activateAcabamentoVariacao,
  deactivateAcabamentoVariacao,
  deleteAcabamentoVariacao,
  ensureProdutoCatalogItem,
} from "@/api/adminSystem";
import type {
  SystemCatalogAdminItem,
  SystemCatalogCategoryKey,
  SystemCatalogVariacao,
} from "@/features/configuracoes/types";

import {
  ConfigErrorState,
  ConfigLoadingState,
  ConfigSection,
  ConfigSectionBody,
  ConfigSectionHeader,
  ConfigSidebarGroupLabel,
  ConfigSidebarLayout,
  ConfigSubsection,
} from "./ConfigSectionLayout";
import { ProdutoEtapasPanel } from "./ProdutoEtapasPanel";

const CATEGORY_ICONS: Record<SystemCatalogCategoryKey, ReactNode> = {
  setor: <Building2 className="size-3.5" aria-hidden />,
  situacao: <Workflow className="size-3.5" aria-hidden />,
  cliente: <Users className="size-3.5" aria-hidden />,
  produto: <Package className="size-3.5" aria-hidden />,
  papel: <Layers className="size-3.5" aria-hidden />,
  maquina: <Printer className="size-3.5" aria-hidden />,
  categoria: <Tag className="size-3.5" aria-hidden />,
  cor: <Palette className="size-3.5" aria-hidden />,
  formato: <Ruler className="size-3.5" aria-hidden />,
  acabamento: <Scissors className="size-3.5" aria-hidden />,
};

function catalogQueryKey(category: SystemCatalogCategoryKey) {
  return ["admin", "system-catalog", category] as const;
}

export function SistemaSettingsSection() {
  const qc = useQueryClient();
  const categoriesQuery = useQuery({
    queryKey: ["admin", "system-catalog", "categories"],
    queryFn: fetchSystemCatalogCategories,
  });

  const categories = categoriesQuery.data ?? [];
  const [activeCategory, setActiveCategory] = useState<SystemCatalogCategoryKey>("setor");
  const [search, setSearch] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [showInactive, setShowInactive] = useState(true);

  const itemsQuery = useQuery({
    queryKey: catalogQueryKey(activeCategory),
    queryFn: () => fetchSystemCatalogItems(activeCategory),
  });

  const activeMeta = useMemo(
    () => categories.find((c) => c.key === activeCategory) ?? itemsQuery.data?.meta,
    [categories, activeCategory, itemsQuery.data?.meta],
  );

  const filteredItems = useMemo(() => {
    const items = itemsQuery.data?.items ?? [];
    const term = search.trim().toLowerCase();
    return items.filter((item) => {
      if (!showInactive && !item.active) return false;
      if (!term) return true;
      return item.label.toLowerCase().includes(term);
    });
  }, [itemsQuery.data?.items, search, showInactive]);

  const stats = useMemo(() => {
    const items = itemsQuery.data?.items ?? [];
    return {
      total: items.length,
      active: items.filter((i) => i.active).length,
      inactive: items.filter((i) => !i.active).length,
      catalogOnly: items.filter((i) => i.source === "catalog" && !i.in_use).length,
    };
  }, [itemsQuery.data?.items]);

  const invalidateCatalog = () => {
    void qc.invalidateQueries({ queryKey: catalogQueryKey(activeCategory) });
    void qc.invalidateQueries({ queryKey: ["aux"] });
  };

  const reportError = (error: unknown) => {
    window.alert(error instanceof Error ? error.message : "Operação falhou.");
  };

  const createMutation = useMutation({
    mutationFn: () => createSystemCatalogItem(activeCategory, { label: newLabel.trim() }),
    onSuccess: () => {
      setNewLabel("");
      invalidateCatalog();
    },
    onError: reportError,
  });

  const toggleMutation = useMutation({
    mutationFn: async (item: SystemCatalogAdminItem) => {
      if (item.id != null) {
        return item.active
          ? deactivateSystemCatalogItem(activeCategory, item.id)
          : activateSystemCatalogItem(activeCategory, item.id);
      }
      return item.active
        ? deactivateSystemCatalogByLabel(activeCategory, item.label)
        : activateSystemCatalogByLabel(activeCategory, item.label);
    },
    onSuccess: invalidateCatalog,
    onError: reportError,
  });

  const deleteMutation = useMutation({
    mutationFn: (itemId: number) => deleteSystemCatalogItem(activeCategory, itemId),
    onSuccess: invalidateCatalog,
    onError: reportError,
  });

  const handleDelete = (item: SystemCatalogAdminItem) => {
    if (item.id == null) {
      void toggleMutation.mutateAsync({ ...item, active: true }).then(() =>
        deactivateSystemCatalogByLabel(activeCategory, item.label).then(invalidateCatalog),
      );
      return;
    }
    const msg = item.in_use
      ? `"${item.label}" já foi usado no sistema.\n\nDesative em vez de excluir — os registros históricos permanecem intactos.`
      : `Excluir "${item.label}" permanentemente?`;
    if (!window.confirm(msg)) return;
    if (item.in_use) return;
    void deleteMutation.mutate(item.id);
  };

  const pending =
    createMutation.isPending || toggleMutation.isPending || deleteMutation.isPending;

  return (
    <ConfigSection>
      <ConfigSectionHeader
        title="Cadastros do sistema"
        description="Gerencie listas usadas em formulários, filtros e fluxos operacionais. Itens desativados somem das listas de seleção, mas permanecem nos registros já existentes."
        icon={<Layers className="size-4" aria-hidden />}
      />

      <ConfigSectionBody noPadding>
        {categoriesQuery.isPending ? (
          <div className="p-4">
            <ConfigLoadingState>
              <Loader2 className="size-4 animate-spin" />
              Carregando categorias…
            </ConfigLoadingState>
          </div>
        ) : null}

        {categoriesQuery.isError ? (
          <div className="p-4">
            <ConfigErrorState>
              {categoriesQuery.error instanceof Error
                ? categoriesQuery.error.message
                : "Erro ao carregar categorias."}
            </ConfigErrorState>
          </div>
        ) : null}

        {!categoriesQuery.isPending && !categoriesQuery.isError ? (
          <ConfigSidebarLayout
            className="p-4"
            sidebar={
              <div className="space-y-1">
                <ConfigSidebarGroupLabel>Listas</ConfigSidebarGroupLabel>
                {categories.map((cat) => {
                  const selected = activeCategory === cat.key;
                  return (
                    <button
                      key={cat.key}
                      type="button"
                      onClick={() => {
                        setActiveCategory(cat.key);
                        setSearch("");
                      }}
                      className={cn(
                        "flex w-full items-start gap-2 rounded-md px-2 py-2 text-left text-xs transition-colors",
                        selected
                          ? "bg-white font-semibold text-secondary-blue shadow-sm ring-1 ring-slate-200/80"
                          : "text-slate-600 hover:bg-white/70 hover:text-secondary-blue",
                      )}
                    >
                      <span className="mt-0.5 shrink-0 text-secondary-blue">
                        {CATEGORY_ICONS[cat.key]}
                      </span>
                      <span className="min-w-0">
                        <span className="block">{cat.label}</span>
                        <span className="mt-0.5 block text-[10px] font-normal leading-snug text-slate-500">
                          {cat.description}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            }
          >
            <div className="space-y-4">
              <ConfigSubsection tone="highlight">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="flex items-center gap-2 text-sm font-bold text-slate-800">
                      {CATEGORY_ICONS[activeCategory]}
                      {activeMeta?.label ?? "Lista"}
                    </h3>
                    <p className="mt-1 text-xs leading-relaxed text-slate-600">
                      {activeMeta?.description}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                    <span className="rounded-full bg-white px-2 py-1 ring-1 ring-slate-200">
                      {stats.total} itens
                    </span>
                    <span className="rounded-full bg-emerald-50 px-2 py-1 text-emerald-700 ring-1 ring-emerald-200">
                      {stats.active} ativos
                    </span>
                    {stats.inactive > 0 ? (
                      <span className="rounded-full bg-amber-50 px-2 py-1 text-amber-700 ring-1 ring-amber-200">
                        {stats.inactive} inativos
                      </span>
                    ) : null}
                  </div>
                </div>

                <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
                  <div className="relative min-w-0 flex-1">
                    <Search
                      className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-slate-400"
                      aria-hidden
                    />
                    <input
                      type="search"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Buscar nesta lista…"
                      className="h-9 w-full rounded-lg border border-slate-300 bg-white pl-8 pr-3 text-xs outline-none ring-secondary-blue/30 focus:ring-2"
                    />
                  </div>
                  <label className="inline-flex shrink-0 cursor-pointer items-center gap-2 text-xs text-slate-600">
                    <input
                      type="checkbox"
                      checked={showInactive}
                      onChange={(e) => setShowInactive(e.target.checked)}
                      className="accent-primary-green"
                    />
                    Mostrar inativos
                  </label>
                </div>

                <form
                  className="mt-3 flex flex-col gap-2 sm:flex-row"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!newLabel.trim()) return;
                    void createMutation.mutate();
                  }}
                >
                  <input
                    type="text"
                    value={newLabel}
                    onChange={(e) => setNewLabel(e.target.value)}
                    placeholder={`Novo item em ${activeMeta?.label ?? "lista"}…`}
                    maxLength={255}
                    className="h-9 min-w-0 flex-1 rounded-lg border border-slate-300 px-3 text-xs outline-none ring-secondary-blue/30 focus:ring-2"
                  />
                  <button
                    type="submit"
                    disabled={pending || !newLabel.trim()}
                    className="inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-lg bg-primary-green px-4 text-xs font-semibold text-white hover:bg-primary-green/90 disabled:opacity-60"
                  >
                    {createMutation.isPending ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <Plus className="size-3.5" />
                    )}
                    Incluir
                  </button>
                </form>
              </ConfigSubsection>

              {itemsQuery.isPending ? (
                <ConfigLoadingState>
                  <Loader2 className="size-4 animate-spin" />
                  Carregando itens…
                </ConfigLoadingState>
              ) : null}

              {itemsQuery.isError ? (
                <ConfigErrorState>
                  {itemsQuery.error instanceof Error
                    ? itemsQuery.error.message
                    : "Erro ao carregar itens."}
                </ConfigErrorState>
              ) : null}

              {!itemsQuery.isPending && !itemsQuery.isError ? (
                <div className="overflow-hidden rounded-lg border border-slate-200">
                  <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-slate-500">
                    <span>Nome</span>
                    <span>Ações</span>
                  </div>

                  {filteredItems.length === 0 ? (
                    <p className="px-4 py-8 text-center text-xs text-slate-500">
                      Nenhum item encontrado nesta lista.
                    </p>
                  ) : (
                    <ul className="divide-y divide-slate-100">
                      {filteredItems.map((item) => (
                        <CatalogItemRow
                          key={`${item.id ?? "usage"}-${item.label}`}
                          item={item}
                          pending={pending}
                          showVariacoes={activeCategory === "acabamento"}
                          showEtapas={activeCategory === "produto"}
                          onToggle={() => void toggleMutation.mutate(item)}
                          onDelete={() => handleDelete(item)}
                        />
                      ))}
                    </ul>
                  )}
                </div>
              ) : null}

              <p className="text-[11px] leading-relaxed text-slate-500">
                Itens com origem <strong>em uso</strong> vêm de OSs já cadastradas. Você pode
                desativá-los para ocultar das listas, mas não excluí-los sem perder o histórico.
                Itens <strong>cadastrados</strong> aqui podem ser excluídos se ainda não foram
                utilizados.
              </p>
            </div>
          </ConfigSidebarLayout>
        ) : null}
      </ConfigSectionBody>
    </ConfigSection>
  );
}

function CatalogItemRow({
  item,
  pending,
  showVariacoes,
  showEtapas,
  onToggle,
  onDelete,
}: {
  item: SystemCatalogAdminItem;
  pending: boolean;
  showVariacoes?: boolean;
  showEtapas?: boolean;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [catalogId, setCatalogId] = useState<number | null>(item.id);
  const expandable = Boolean((showVariacoes && item.id != null) || showEtapas);

  useEffect(() => {
    setCatalogId(item.id);
  }, [item.id]);

  const ensureMut = useMutation({
    mutationFn: () => ensureProdutoCatalogItem(item.label),
    onSuccess: (data) => {
      setCatalogId(data.item.id);
      void qc.invalidateQueries({ queryKey: ["admin", "system-catalog", "produto"] });
    },
    onError: (err) =>
      window.alert(err instanceof Error ? err.message : "Falha ao abrir o produto."),
  });

  const toggleExpand = () => {
    if (expanded) {
      setExpanded(false);
      return;
    }
    if (showEtapas && catalogId == null) {
      void ensureMut.mutateAsync().then(() => setExpanded(true));
      return;
    }
    setExpanded(true);
  };

  return (
    <li className={cn(!item.active && "bg-slate-50/80")}>
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-3 py-2.5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {expandable ? (
              <button
                type="button"
                onClick={toggleExpand}
                className="inline-flex items-center gap-1 text-slate-500 hover:text-secondary-blue"
                title={expanded ? "Recolher" : "Expandir"}
              >
                {ensureMut.isPending ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : expanded ? (
                  <ChevronDown className="size-3.5" aria-hidden />
                ) : (
                  <ChevronRight className="size-3.5" aria-hidden />
                )}
              </button>
            ) : null}
            <span
              className={cn(
                "text-sm font-medium",
                item.active ? "text-slate-800" : "text-slate-500 line-through",
              )}
            >
              {item.label}
            </span>
            <span
              className={cn(
                "rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                item.active
                  ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
                  : "bg-slate-100 text-slate-500 ring-1 ring-slate-200",
              )}
            >
              {item.active ? "Ativo" : "Inativo"}
            </span>
            <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
              {item.source === "catalog" ? "Cadastrado" : "Em uso"}
            </span>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            disabled={pending}
            onClick={onToggle}
            title={item.active ? "Desativar" : "Ativar"}
            className="inline-flex size-8 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-60"
          >
            {item.active ? (
              <ToggleRight className="size-4 text-emerald-600" aria-hidden />
            ) : (
              <ToggleLeft className="size-4 text-slate-400" aria-hidden />
            )}
          </button>
          <button
            type="button"
            disabled={pending || (item.in_use && item.id == null)}
            onClick={onDelete}
            title={item.in_use ? "Desative em vez de excluir" : "Excluir"}
            className="inline-flex size-8 items-center justify-center rounded-md border border-red-200 bg-white text-red-600 hover:bg-red-50 disabled:opacity-40"
          >
            <Trash2 className="size-3.5" aria-hidden />
          </button>
        </div>
      </div>

      {showVariacoes && item.id != null && expanded ? (
        <>
          <VariacoesPanel catalogId={item.id} />
          <ProdutoEtapasPanel
            catalogId={item.id}
            rotulo={item.label}
            variant="acabamento"
          />
        </>
      ) : null}
      {showEtapas && catalogId != null && expanded ? (
        <ProdutoEtapasPanel catalogId={catalogId} rotulo={item.label} />
      ) : null}
    </li>
  );
}

function VariacoesPanel({ catalogId }: { catalogId: number }) {
  const qc = useQueryClient();
  const [newLabel, setNewLabel] = useState("");
  const queryKey = ["admin", "system-catalog", "variacoes", catalogId] as const;

  const query = useQuery({
    queryKey,
    queryFn: () => fetchAcabamentoVariacoes(catalogId),
  });

  const variacoes = query.data?.variacoes ?? [];

  const invalidate = () => void qc.invalidateQueries({ queryKey });

  const reportError = (error: unknown) => {
    window.alert(error instanceof Error ? error.message : "Operação falhou.");
  };

  const createMutation = useMutation({
    mutationFn: () =>
      createAcabamentoVariacao(catalogId, { label: newLabel.trim() }),
    onSuccess: () => {
      setNewLabel("");
      invalidate();
    },
    onError: reportError,
  });

  const toggleMutation = useMutation({
    mutationFn: (v: SystemCatalogVariacao) =>
      v.active
        ? deactivateAcabamentoVariacao(catalogId, v.id)
        : activateAcabamentoVariacao(catalogId, v.id),
    onSuccess: invalidate,
    onError: reportError,
  });

  const deleteMutation = useMutation({
    mutationFn: (variacaoId: number) =>
      deleteAcabamentoVariacao(catalogId, variacaoId),
    onSuccess: invalidate,
    onError: reportError,
  });

  const pending =
    createMutation.isPending || toggleMutation.isPending || deleteMutation.isPending;

  return (
    <div className="mx-3 mb-3 rounded-md border border-slate-200 bg-slate-50/60">
      <div className="border-b border-slate-200 px-3 py-1.5">
        <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
          Variações
        </span>
      </div>

      {query.isPending ? (
        <div className="flex items-center gap-2 px-3 py-2 text-xs text-slate-500">
          <Loader2 className="size-3 animate-spin" />
          Carregando…
        </div>
      ) : query.isError ? (
        <p className="px-3 py-2 text-xs text-red-600">Erro ao carregar variações.</p>
      ) : (
        <>
          {variacoes.length === 0 ? (
            <p className="px-3 py-2 text-xs text-slate-400 italic">
              Nenhuma variação cadastrada.
            </p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {variacoes.map((v) => (
                <li
                  key={v.id}
                  className={cn(
                    "flex items-center justify-between gap-2 px-3 py-1.5",
                    !v.active && "opacity-60",
                  )}
                >
                  <span
                    className={cn(
                      "text-xs font-medium",
                      v.active ? "text-slate-700" : "text-slate-400 line-through",
                    )}
                  >
                    {v.label}
                  </span>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => void toggleMutation.mutate(v)}
                      title={v.active ? "Desativar" : "Ativar"}
                      className="inline-flex size-6 items-center justify-center rounded border border-slate-200 bg-white text-slate-500 hover:bg-slate-100 disabled:opacity-50"
                    >
                      {v.active ? (
                        <ToggleRight className="size-3.5 text-emerald-600" aria-hidden />
                      ) : (
                        <ToggleLeft className="size-3.5 text-slate-400" aria-hidden />
                      )}
                    </button>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => {
                        if (!window.confirm(`Excluir variação "${v.label}"?`)) return;
                        void deleteMutation.mutate(v.id);
                      }}
                      title="Excluir variação"
                      className="inline-flex size-6 items-center justify-center rounded border border-red-200 bg-white text-red-500 hover:bg-red-50 disabled:opacity-40"
                    >
                      <Trash2 className="size-3" aria-hidden />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <form
            className="flex gap-2 border-t border-slate-200 p-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!newLabel.trim()) return;
              void createMutation.mutate();
            }}
          >
            <input
              type="text"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              placeholder="Nova variação…"
              maxLength={255}
              className="h-7 min-w-0 flex-1 rounded border border-slate-300 px-2 text-xs outline-none ring-secondary-blue/30 focus:ring-2"
            />
            <button
              type="submit"
              disabled={pending || !newLabel.trim()}
              className="inline-flex h-7 shrink-0 items-center gap-1 rounded bg-primary-green px-2.5 text-[11px] font-semibold text-white hover:bg-primary-green/90 disabled:opacity-60"
            >
              {createMutation.isPending ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <Plus className="size-3" />
              )}
              Incluir
            </button>
          </form>
        </>
      )}
    </div>
  );
}
