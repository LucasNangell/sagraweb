import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Check,
  Loader2,
  Package,
  Plus,
  Search,
  X,
} from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";

import {
  atenderEstoquePedido,
  cancelarEstoquePedido,
  createEstoquePedido,
  createEstoqueSku,
  fetchEstoqueAlertas,
  fetchEstoqueCategorias,
  fetchEstoqueMovimentos,
  fetchEstoquePedidos,
  fetchEstoqueResumo,
  fetchEstoqueSkus,
  postEstoqueAjuste,
  postEstoqueEntrada,
  postEstoqueSaida,
  recusarEstoquePedido,
  updateEstoqueSku,
  type EstoquePedido,
  type EstoqueSku,
} from "@/api/estoque";
import { useAccessControl } from "@/features/auth/useAccessControl";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";

type TabId =
  | "dashboard"
  | "catalogo"
  | "movimentar"
  | "pedidos"
  | "movimentos"
  | "buscar"
  | "novo-pedido"
  | "meus-pedidos";

type CartItem = { sku: EstoqueSku; quantidade: number };

function money(n: number | undefined) {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function qty(n: number | undefined) {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toLocaleString("pt-BR", { maximumFractionDigits: 4 });
}

function Panel({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-lg border border-slate-200 bg-white shadow-sm ${className}`}
    >
      {children}
    </div>
  );
}

function Th({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <th
      className={`sticky top-0 z-[1] border-b border-slate-200 bg-slate-50 px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-500 ${className}`}
    >
      {children}
    </th>
  );
}

export function EstoquePage() {
  const { can } = useAccessControl();
  const isGerente = can("sb_estoque_gerente");
  const queryClient = useQueryClient();

  const defaultTab: TabId = isGerente ? "dashboard" : "buscar";
  const [tab, setTab] = useState<TabId>(defaultTab);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 300);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [pedidoObs, setPedidoObs] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [skuForm, setSkuForm] = useState({
    codigo: "",
    nome: "",
    unidade: "un",
    estoque_minimo: "0",
    categoria_id: "",
  });

  const [movForm, setMovForm] = useState({
    sku_id: "",
    tipo: "entrada" as "entrada" | "saida" | "ajuste",
    quantidade: "",
    custo_unitario: "",
    motivo: "",
  });

  const skusQuery = useQuery({
    queryKey: ["estoque", "skus", debouncedSearch, isGerente],
    queryFn: () =>
      fetchEstoqueSkus({
        q: debouncedSearch || undefined,
        include_inactive: isGerente,
      }),
  });

  const categoriasQuery = useQuery({
    queryKey: ["estoque", "categorias"],
    queryFn: fetchEstoqueCategorias,
  });

  const resumoQuery = useQuery({
    queryKey: ["estoque", "resumo"],
    queryFn: fetchEstoqueResumo,
    enabled: isGerente,
  });

  const alertasQuery = useQuery({
    queryKey: ["estoque", "alertas"],
    queryFn: fetchEstoqueAlertas,
    enabled: isGerente,
  });

  const pedidosQuery = useQuery({
    queryKey: ["estoque", "pedidos", isGerente ? "all" : "mine", tab],
    queryFn: () =>
      fetchEstoquePedidos(
        isGerente && tab === "pedidos" ? { status: "pendente" } : undefined,
      ),
  });

  const movimentosQuery = useQuery({
    queryKey: ["estoque", "movimentos"],
    queryFn: () => fetchEstoqueMovimentos(),
    enabled: isGerente && tab === "movimentos",
  });

  const invalidateAll = () => {
    void queryClient.invalidateQueries({ queryKey: ["estoque"] });
  };

  const createSkuMut = useMutation({
    mutationFn: createEstoqueSku,
    onSuccess: () => {
      setMessage("SKU cadastrado.");
      setError(null);
      setSkuForm({
        codigo: "",
        nome: "",
        unidade: "un",
        estoque_minimo: "0",
        categoria_id: "",
      });
      invalidateAll();
    },
    onError: (e: Error) => setError(e.message || "Erro ao cadastrar SKU"),
  });

  const movMut = useMutation({
    mutationFn: async () => {
      const skuId = Number(movForm.sku_id);
      const q = Number(movForm.quantidade.replace(",", "."));
      if (!skuId || Number.isNaN(q)) throw new Error("SKU e quantidade obrigatórios");
      if (movForm.tipo === "entrada") {
        return postEstoqueEntrada({
          sku_id: skuId,
          quantidade: q,
          custo_unitario: movForm.custo_unitario
            ? Number(movForm.custo_unitario.replace(",", "."))
            : undefined,
          motivo: movForm.motivo || undefined,
        });
      }
      if (movForm.tipo === "saida") {
        return postEstoqueSaida({
          sku_id: skuId,
          quantidade: q,
          motivo: movForm.motivo || undefined,
        });
      }
      return postEstoqueAjuste({
        sku_id: skuId,
        quantidade_nova: q,
        motivo: movForm.motivo || "Ajuste de inventário",
      });
    },
    onSuccess: () => {
      setMessage("Movimento registrado.");
      setError(null);
      setMovForm({
        sku_id: "",
        tipo: "entrada",
        quantidade: "",
        custo_unitario: "",
        motivo: "",
      });
      invalidateAll();
    },
    onError: (e: Error) => setError(e.message || "Erro no movimento"),
  });

  const pedidoMut = useMutation({
    mutationFn: () =>
      createEstoquePedido({
        itens: cart.map((c) => ({
          sku_id: c.sku.id,
          quantidade: c.quantidade,
        })),
        observacao: pedidoObs || undefined,
      }),
    onSuccess: () => {
      setMessage("Pedido enviado.");
      setError(null);
      setCart([]);
      setPedidoObs("");
      setTab("meus-pedidos");
      invalidateAll();
    },
    onError: (e: Error) => setError(e.message || "Erro ao criar pedido"),
  });

  const tabs = useMemo(() => {
    if (isGerente) {
      return [
        { id: "dashboard" as const, label: "Dashboard" },
        { id: "catalogo" as const, label: "Catálogo" },
        { id: "movimentar" as const, label: "Movimentar" },
        { id: "pedidos" as const, label: "Pedidos" },
        { id: "movimentos" as const, label: "Movimentos" },
        { id: "buscar" as const, label: "Buscar" },
        { id: "novo-pedido" as const, label: "Novo pedido" },
        { id: "meus-pedidos" as const, label: "Meus pedidos" },
      ];
    }
    return [
      { id: "buscar" as const, label: "Buscar materiais" },
      { id: "novo-pedido" as const, label: "Novo pedido" },
      { id: "meus-pedidos" as const, label: "Meus pedidos" },
    ];
  }, [isGerente]);

  const addToCart = (sku: EstoqueSku) => {
    setCart((prev) => {
      const existing = prev.find((p) => p.sku.id === sku.id);
      if (existing) {
        const nextQty = Math.min(existing.quantidade + 1, sku.disponivel);
        return prev.map((p) =>
          p.sku.id === sku.id ? { ...p, quantidade: nextQty } : p,
        );
      }
      if (sku.disponivel <= 0) return prev;
      return [...prev, { sku, quantidade: 1 }];
    });
    setTab("novo-pedido");
  };

  const skus = skusQuery.data?.items ?? [];
  const gerenteCols = isGerente ? 6 : 4;

  const renderSkuRows = () => {
    if (skusQuery.isLoading) {
      return (
        <tr>
          <td colSpan={gerenteCols} className="px-3 py-10 text-center text-slate-400">
            <Loader2 className="mx-auto size-5 animate-spin" />
          </td>
        </tr>
      );
    }
    if (skus.length === 0) {
      return (
        <tr>
          <td colSpan={gerenteCols} className="px-3 py-10 text-center text-slate-500">
            Nenhum material encontrado.
          </td>
        </tr>
      );
    }
    return skus.map((s) => (
      <tr key={s.id} className="border-t border-slate-100 hover:bg-slate-50/80">
        <td className="px-3 py-2.5 font-medium whitespace-nowrap text-slate-800">
          {s.codigo}
        </td>
        <td className="max-w-[14rem] px-3 py-2.5 text-slate-700 sm:max-w-none">
          <span className="break-words">{s.nome}</span>
          {s.alerta_baixo && isGerente ? (
            <span className="ml-2 inline-block text-xs text-amber-700">baixo</span>
          ) : null}
        </td>
        <td className="px-3 py-2.5 whitespace-nowrap">
          {qty(s.disponivel)} {s.unidade}
        </td>
        {isGerente ? (
          <td className="px-3 py-2.5">
            <input
              aria-label={`Estoque mínimo ${s.codigo}`}
              className="w-20 max-w-full rounded border border-slate-300 px-1.5 py-1 text-sm"
              defaultValue={s.estoque_minimo}
              onBlur={(e) => {
                const v = Number(e.target.value.replace(",", "."));
                if (!Number.isNaN(v) && v !== s.estoque_minimo) {
                  void updateEstoqueSku(s.id, { estoque_minimo: v }).then(() =>
                    invalidateAll(),
                  );
                }
              }}
            />
          </td>
        ) : null}
        {isGerente ? (
          <td className="px-3 py-2.5 whitespace-nowrap">{money(s.custo_medio)}</td>
        ) : null}
        <td className="px-3 py-2.5">
          <button
            type="button"
            disabled={s.disponivel <= 0}
            onClick={() => addToCart(s)}
            className="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50 disabled:opacity-40"
          >
            Pedir
          </button>
        </td>
      </tr>
    ));
  };

  const renderSkuCards = () => {
    if (skusQuery.isLoading) {
      return (
        <div className="flex justify-center p-8 text-slate-400">
          <Loader2 className="size-5 animate-spin" />
        </div>
      );
    }
    if (skus.length === 0) {
      return (
        <p className="p-6 text-center text-sm text-slate-500">
          Nenhum material encontrado.
        </p>
      );
    }
    return (
      <ul className="divide-y divide-slate-100">
        {skus.map((s) => (
          <li key={s.id} className="flex flex-col gap-2 px-3 py-3 sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1">
              <div className="font-medium text-slate-800">{s.codigo}</div>
              <div className="break-words text-sm text-slate-600">{s.nome}</div>
              <div className="mt-1 text-xs text-slate-500">
                Disp.: {qty(s.disponivel)} {s.unidade}
                {isGerente ? ` · Mín.: ${qty(s.estoque_minimo)} · ${money(s.custo_medio)}` : ""}
              </div>
            </div>
            <button
              type="button"
              disabled={s.disponivel <= 0}
              onClick={() => addToCart(s)}
              className="shrink-0 self-start rounded border border-slate-300 px-3 py-1.5 text-xs hover:bg-slate-50 disabled:opacity-40 sm:self-center"
            >
              Pedir
            </button>
          </li>
        ))}
      </ul>
    );
  };

  const renderPedidos = (list: EstoquePedido[]) => {
    if (pedidosQuery.isLoading) {
      return (
        <div className="flex justify-center p-8">
          <Loader2 className="size-5 animate-spin text-slate-400" />
        </div>
      );
    }
    if (list.length === 0) {
      return <p className="p-6 text-center text-sm text-slate-500">Nenhum pedido.</p>;
    }
    return (
      <ul className="divide-y divide-slate-100">
        {list.map((p) => (
          <li key={p.id} className="px-3 py-3 text-sm sm:px-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
              <div className="min-w-0">
                <strong>#{p.id}</strong>{" "}
                <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">
                  {p.status}
                </span>
                <div className="mt-0.5 text-xs text-slate-500 break-words">
                  ponto {p.solicitante_ponto} · {p.criado_em}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {isGerente && p.status === "pendente" && tab === "pedidos" ? (
                  <>
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 rounded bg-primary-green px-2 py-1 text-xs text-white"
                      onClick={() =>
                        void atenderEstoquePedido(p.id)
                          .then(() => {
                            setMessage(`Pedido #${p.id} atendido.`);
                            invalidateAll();
                          })
                          .catch((e: Error) => setError(e.message))
                      }
                    >
                      <Check className="size-3" /> Atender
                    </button>
                    <button
                      type="button"
                      className="rounded border border-slate-300 px-2 py-1 text-xs"
                      onClick={() =>
                        void recusarEstoquePedido(p.id, "Recusado pelo gerente")
                          .then(() => {
                            setMessage(`Pedido #${p.id} recusado.`);
                            invalidateAll();
                          })
                          .catch((e: Error) => setError(e.message))
                      }
                    >
                      Recusar
                    </button>
                  </>
                ) : null}
                {p.status === "pendente" && tab === "meus-pedidos" ? (
                  <button
                    type="button"
                    className="rounded border border-slate-300 px-2 py-1 text-xs"
                    onClick={() =>
                      void cancelarEstoquePedido(p.id)
                        .then(() => {
                          setMessage(`Pedido #${p.id} cancelado.`);
                          invalidateAll();
                        })
                        .catch((e: Error) => setError(e.message))
                    }
                  >
                    Cancelar
                  </button>
                ) : null}
              </div>
            </div>
            <ul className="mt-2 space-y-0.5 text-slate-600">
              {p.itens.map((it) => (
                <li key={it.id} className="break-words">
                  {it.sku_codigo} — {it.sku_nome}: {qty(it.qtd_solicitada)} {it.unidade}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    );
  };

  return (
    <div className="flex min-h-min flex-1 flex-col gap-3 md:h-full md:min-h-0 md:overflow-hidden">
      <header className="shrink-0 rounded-lg border border-slate-200 bg-white px-3 py-3 shadow-sm sm:px-4">
        <div className="flex items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary-green/15 text-primary-green">
            <Package className="size-5" />
          </div>
          <div className="min-w-0">
            <h1 className="text-lg font-semibold text-slate-800 sm:text-xl">Estoque</h1>
            <p className="text-sm text-slate-500">
              {isGerente
                ? "Gestão completa de materiais, custos e pedidos"
                : "Consulta e pedido de materiais disponíveis"}
            </p>
          </div>
        </div>
      </header>

      <nav
        className="shrink-0 overflow-x-auto overscroll-x-contain [-webkit-overflow-scrolling:touch]"
        aria-label="Seções do estoque"
      >
        <div className="flex w-max min-w-full gap-1 border-b border-slate-200 pb-px">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`shrink-0 rounded-t px-3 py-2 text-sm font-medium whitespace-nowrap ${
                tab === t.id
                  ? "-mb-px border border-b-white border-slate-200 bg-white text-primary-green"
                  : "text-slate-600 hover:bg-slate-50"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </nav>

      {(message || error) && (
        <div
          role="status"
          className={`shrink-0 rounded border px-3 py-2 text-sm ${
            error
              ? "border-red-200 bg-red-50 text-red-800"
              : "border-emerald-200 bg-emerald-50 text-emerald-800"
          }`}
        >
          <div className="flex items-start justify-between gap-2">
            <span className="min-w-0 break-words">{error || message}</span>
            <button
              type="button"
              className="shrink-0 underline"
              onClick={() => {
                setMessage(null);
                setError(null);
              }}
            >
              fechar
            </button>
          </div>
        </div>
      )}

      {/* Área rolável: no desktop o AppShell trava overflow; aqui a página faz o scroll */}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-y-contain [-webkit-overflow-scrolling:touch]">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 pb-6">
          {tab === "dashboard" && isGerente ? (
            <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {[
                {
                  label: "SKUs ativos",
                  value: resumoQuery.data?.skus_ativos ?? "—",
                },
                {
                  label: "Alertas",
                  value: resumoQuery.data?.alertas ?? "—",
                  warn: (resumoQuery.data?.alertas ?? 0) > 0,
                },
                {
                  label: "Pedidos pendentes",
                  value: resumoQuery.data?.pedidos_pendentes ?? "—",
                },
                {
                  label: "Valor em estoque",
                  value: money(resumoQuery.data?.valor_estoque),
                },
              ].map((card) => (
                <div
                  key={card.label}
                  className={`rounded-lg border p-4 ${
                    card.warn
                      ? "border-amber-300 bg-amber-50"
                      : "border-slate-200 bg-white"
                  }`}
                >
                  <div className="text-xs uppercase tracking-wide text-slate-500">
                    {card.label}
                  </div>
                  <div className="mt-1 break-words text-xl font-semibold text-slate-800 sm:text-2xl">
                    {card.value}
                  </div>
                </div>
              ))}
              <Panel className="sm:col-span-2 lg:col-span-4">
                <div className="border-b border-slate-100 px-4 py-3">
                  <h2 className="flex items-center gap-2 font-medium text-slate-800">
                    <AlertTriangle className="size-4 shrink-0 text-amber-600" />
                    Estoque baixo
                  </h2>
                </div>
                <div className="max-h-[min(24rem,50vh)] overflow-y-auto overscroll-contain">
                  {alertasQuery.isLoading ? (
                    <div className="flex justify-center p-6">
                      <Loader2 className="size-5 animate-spin text-slate-400" />
                    </div>
                  ) : (alertasQuery.data?.items.length ?? 0) === 0 ? (
                    <p className="p-4 text-sm text-slate-500">
                      Nenhum alerta no momento.
                    </p>
                  ) : (
                    <ul className="divide-y divide-slate-100 px-4">
                      {alertasQuery.data?.items.map((s) => (
                        <li
                          key={s.id}
                          className="flex flex-col gap-1 py-2.5 text-sm sm:flex-row sm:items-center sm:justify-between"
                        >
                          <span className="min-w-0 break-words">
                            <strong>{s.codigo}</strong> — {s.nome}
                          </span>
                          <span className="shrink-0 text-amber-700">
                            {qty(s.quantidade)} / mín. {qty(s.estoque_minimo)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </Panel>
            </section>
          ) : null}

          {(tab === "buscar" || tab === "catalogo") && (
            <section className="flex flex-col gap-3">
              <div className="relative w-full">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Buscar por código, nome…"
                  className="w-full rounded-lg border border-slate-300 bg-white py-2.5 pl-9 pr-3 text-sm shadow-sm"
                />
              </div>

              {tab === "catalogo" && isGerente ? (
                <form
                  className="grid grid-cols-1 gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 sm:grid-cols-2 lg:grid-cols-6"
                  onSubmit={(e) => {
                    e.preventDefault();
                    createSkuMut.mutate({
                      codigo: skuForm.codigo,
                      nome: skuForm.nome,
                      unidade: skuForm.unidade,
                      estoque_minimo:
                        Number(skuForm.estoque_minimo.replace(",", ".")) || 0,
                      categoria_id: skuForm.categoria_id
                        ? Number(skuForm.categoria_id)
                        : undefined,
                    });
                  }}
                >
                  <input
                    required
                    placeholder="Código"
                    className="rounded border border-slate-300 px-2 py-2 text-sm"
                    value={skuForm.codigo}
                    onChange={(e) =>
                      setSkuForm((s) => ({ ...s, codigo: e.target.value }))
                    }
                  />
                  <input
                    required
                    placeholder="Nome"
                    className="rounded border border-slate-300 px-2 py-2 text-sm sm:col-span-2 lg:col-span-2"
                    value={skuForm.nome}
                    onChange={(e) =>
                      setSkuForm((s) => ({ ...s, nome: e.target.value }))
                    }
                  />
                  <input
                    placeholder="Unidade"
                    className="rounded border border-slate-300 px-2 py-2 text-sm"
                    value={skuForm.unidade}
                    onChange={(e) =>
                      setSkuForm((s) => ({ ...s, unidade: e.target.value }))
                    }
                  />
                  <input
                    placeholder="Estoque mín."
                    className="rounded border border-slate-300 px-2 py-2 text-sm"
                    value={skuForm.estoque_minimo}
                    onChange={(e) =>
                      setSkuForm((s) => ({ ...s, estoque_minimo: e.target.value }))
                    }
                  />
                  <select
                    className="rounded border border-slate-300 px-2 py-2 text-sm"
                    value={skuForm.categoria_id}
                    onChange={(e) =>
                      setSkuForm((s) => ({ ...s, categoria_id: e.target.value }))
                    }
                  >
                    <option value="">Categoria</option>
                    {categoriasQuery.data?.items.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.nome}
                      </option>
                    ))}
                  </select>
                  <button
                    type="submit"
                    disabled={createSkuMut.isPending}
                    className="flex items-center justify-center gap-1 rounded bg-primary-green px-3 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60 sm:col-span-2 lg:col-span-6"
                  >
                    <Plus className="size-4" />
                    Cadastrar SKU
                  </button>
                </form>
              ) : null}

              {/* Mobile: lista em cards */}
              <Panel className="md:hidden">{renderSkuCards()}</Panel>

              {/* Desktop/tablet: tabela com scroll próprio e thead sticky */}
              <Panel className="hidden max-h-[min(70vh,42rem)] flex-col overflow-hidden md:flex">
                <div className="min-h-0 flex-1 overflow-auto overscroll-contain [-webkit-overflow-scrolling:touch]">
                  <table
                    className="w-full text-left text-sm"
                    style={{ minWidth: isGerente ? "44rem" : "32rem" }}
                  >
                    <thead>
                      <tr>
                        <Th>Código</Th>
                        <Th>Nome</Th>
                        <Th>Disponível</Th>
                        {isGerente ? <Th>Mínimo</Th> : null}
                        {isGerente ? <Th>Custo médio</Th> : null}
                        <Th>Ações</Th>
                      </tr>
                    </thead>
                    <tbody>{renderSkuRows()}</tbody>
                  </table>
                </div>
              </Panel>
            </section>
          )}

          {tab === "movimentar" && isGerente ? (
            <section className="w-full max-w-xl">
              <Panel className="p-4">
                <h2 className="mb-3 font-medium text-slate-800">
                  Entrada / Saída / Ajuste
                </h2>
                <div className="flex flex-col gap-3">
                  <select
                    className="rounded border border-slate-300 px-2 py-2 text-sm"
                    value={movForm.sku_id}
                    onChange={(e) =>
                      setMovForm((m) => ({ ...m, sku_id: e.target.value }))
                    }
                  >
                    <option value="">Selecione o SKU</option>
                    {skus.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.codigo} — {s.nome}
                      </option>
                    ))}
                  </select>
                  <select
                    className="rounded border border-slate-300 px-2 py-2 text-sm"
                    value={movForm.tipo}
                    onChange={(e) =>
                      setMovForm((m) => ({
                        ...m,
                        tipo: e.target.value as "entrada" | "saida" | "ajuste",
                      }))
                    }
                  >
                    <option value="entrada">Entrada</option>
                    <option value="saida">Saída</option>
                    <option value="ajuste">Ajuste (quantidade final)</option>
                  </select>
                  <input
                    placeholder={
                      movForm.tipo === "ajuste" ? "Quantidade nova" : "Quantidade"
                    }
                    className="rounded border border-slate-300 px-2 py-2 text-sm"
                    value={movForm.quantidade}
                    onChange={(e) =>
                      setMovForm((m) => ({ ...m, quantidade: e.target.value }))
                    }
                  />
                  {movForm.tipo === "entrada" ? (
                    <input
                      placeholder="Custo unitário (opcional)"
                      className="rounded border border-slate-300 px-2 py-2 text-sm"
                      value={movForm.custo_unitario}
                      onChange={(e) =>
                        setMovForm((m) => ({
                          ...m,
                          custo_unitario: e.target.value,
                        }))
                      }
                    />
                  ) : null}
                  <input
                    placeholder="Motivo / observação"
                    className="rounded border border-slate-300 px-2 py-2 text-sm"
                    value={movForm.motivo}
                    onChange={(e) =>
                      setMovForm((m) => ({ ...m, motivo: e.target.value }))
                    }
                  />
                  <button
                    type="button"
                    disabled={movMut.isPending}
                    onClick={() => movMut.mutate()}
                    className="rounded bg-primary-green px-3 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60"
                  >
                    Registrar
                  </button>
                </div>
              </Panel>
            </section>
          ) : null}

          {tab === "novo-pedido" ? (
            <section className="flex flex-col gap-3">
              <p className="text-sm text-slate-600">
                Adicione materiais pela busca e ajuste as quantidades (máx. disponível).
              </p>
              {cart.length === 0 ? (
                <p className="rounded-lg border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">
                  Carrinho vazio. Use “Pedir” na busca de materiais.
                </p>
              ) : (
                <Panel>
                  <ul className="max-h-[min(50vh,28rem)] divide-y divide-slate-100 overflow-y-auto overscroll-contain">
                    {cart.map((item) => (
                      <li
                        key={item.sku.id}
                        className="flex flex-col gap-2 px-3 py-2.5 text-sm sm:flex-row sm:items-center sm:gap-3"
                      >
                        <span className="min-w-0 flex-1 break-words">
                          <strong>{item.sku.codigo}</strong> — {item.sku.nome}
                          <span className="ml-2 text-slate-500">
                            (disp. {qty(item.sku.disponivel)})
                          </span>
                        </span>
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            min={0.0001}
                            max={item.sku.disponivel}
                            step="any"
                            className="w-24 rounded border border-slate-300 px-2 py-1"
                            value={item.quantidade}
                            onChange={(e) => {
                              const v = Number(e.target.value);
                              setCart((prev) =>
                                prev.map((p) =>
                                  p.sku.id === item.sku.id
                                    ? {
                                        ...p,
                                        quantidade: Math.min(
                                          Math.max(v || 0, 0),
                                          item.sku.disponivel,
                                        ),
                                      }
                                    : p,
                                ),
                              );
                            }}
                          />
                          <button
                            type="button"
                            onClick={() =>
                              setCart((prev) =>
                                prev.filter((p) => p.sku.id !== item.sku.id),
                              )
                            }
                            className="text-slate-400 hover:text-red-600"
                            aria-label="Remover item"
                          >
                            <X className="size-4" />
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </Panel>
              )}
              <textarea
                placeholder="Observação (opcional)"
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                rows={2}
                value={pedidoObs}
                onChange={(e) => setPedidoObs(e.target.value)}
              />
              <button
                type="button"
                disabled={cart.length === 0 || pedidoMut.isPending}
                onClick={() => pedidoMut.mutate()}
                className="self-stretch rounded bg-primary-green px-4 py-2.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60 sm:self-start"
              >
                Enviar pedido
              </button>
            </section>
          ) : null}

          {(tab === "pedidos" || tab === "meus-pedidos") && (
            <Panel className="max-h-[min(75vh,48rem)] overflow-y-auto overscroll-contain">
              {renderPedidos(
                (pedidosQuery.data?.items ?? []).filter((p) =>
                  tab === "pedidos" ? p.status === "pendente" || isGerente : true,
                ),
              )}
            </Panel>
          )}

          {tab === "movimentos" && isGerente ? (
            <Panel className="flex max-h-[min(75vh,48rem)] flex-col overflow-hidden">
              <div className="min-h-0 flex-1 overflow-auto overscroll-contain [-webkit-overflow-scrolling:touch]">
                <table className="w-full text-left text-sm" style={{ minWidth: "40rem" }}>
                  <thead>
                    <tr>
                      <Th>Data</Th>
                      <Th>Tipo</Th>
                      <Th>SKU</Th>
                      <Th>Qtd</Th>
                      <Th>Custo</Th>
                      <Th>Saldo após</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {(movimentosQuery.data?.items ?? []).length === 0 ? (
                      <tr>
                        <td
                          colSpan={6}
                          className="px-3 py-8 text-center text-slate-500"
                        >
                          {movimentosQuery.isLoading ? (
                            <Loader2 className="mx-auto size-5 animate-spin" />
                          ) : (
                            "Nenhum movimento."
                          )}
                        </td>
                      </tr>
                    ) : (
                      (movimentosQuery.data?.items ?? []).map((m) => (
                        <tr key={m.id} className="border-t border-slate-100">
                          <td className="px-3 py-2 whitespace-nowrap">{m.criado_em}</td>
                          <td className="px-3 py-2">{m.tipo}</td>
                          <td className="max-w-[16rem] px-3 py-2 break-words">
                            {m.sku_codigo} — {m.sku_nome}
                          </td>
                          <td className="px-3 py-2 whitespace-nowrap">
                            {qty(m.quantidade)}
                          </td>
                          <td className="px-3 py-2 whitespace-nowrap">
                            {money(m.custo_total)}
                          </td>
                          <td className="px-3 py-2 whitespace-nowrap">
                            {qty(m.saldo_apos)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </Panel>
          ) : null}
        </div>
      </div>
    </div>
  );
}
