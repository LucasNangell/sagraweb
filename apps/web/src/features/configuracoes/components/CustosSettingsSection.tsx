import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { cn } from "@sagra/ui";
import {
  Loader2,
  Pencil,
  Plus,
  Search,
  ToggleLeft,
  ToggleRight,
  Users,
  X,
} from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";

import {
  activateCustoFuncao,
  createCustoFuncao,
  deactivateCustoFuncao,
  fetchCustoFuncoes,
  updateCustoFuncao,
} from "@/api/adminSystem";
import type { CustoFuncaoRecord } from "@/features/configuracoes/types";

import {
  ConfigErrorState,
  ConfigLoadingState,
  ConfigSection,
  ConfigSectionBody,
  ConfigSectionHeader,
  ConfigSubsection,
} from "./ConfigSectionLayout";

const QUERY_KEY = ["admin", "custos-funcoes"] as const;
const HORAS_MES_PREVIEW = 176;

function money(n: number | undefined | null) {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function parseMoneyInput(raw: string): number | null {
  const cleaned = raw.trim().replace(/\./g, "").replace(",", ".");
  if (!cleaned) return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value) || value < 0) return null;
  return value;
}

type FormState = {
  nome: string;
  codigo: string;
  descricao: string;
  custoMensal: string;
  quantidade: string;
  alocacao: "etapa" | "overhead";
};

const EMPTY_FORM: FormState = {
  nome: "",
  codigo: "",
  descricao: "",
  custoMensal: "",
  quantidade: "1",
  alocacao: "etapa",
};

export function CustosSettingsSection() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [showInactive, setShowInactive] = useState(true);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<number | null>(null);

  const listQuery = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => fetchCustoFuncoes(true),
  });

  const horasMes = listQuery.data?.horas_mes_padrao ?? HORAS_MES_PREVIEW;

  const filtered = useMemo(() => {
    const items = listQuery.data?.items ?? [];
    const term = search.trim().toLowerCase();
    return items.filter((item) => {
      if (!showInactive && !item.ativo) return false;
      if (!term) return true;
      return (
        item.nome.toLowerCase().includes(term) ||
        (item.codigo ?? "").toLowerCase().includes(term) ||
        (item.descricao ?? "").toLowerCase().includes(term)
      );
    });
  }, [listQuery.data?.items, search, showInactive]);

  const stats = useMemo(() => {
    const items = listQuery.data?.items ?? [];
    return {
      total: items.length,
      active: items.filter((i) => i.ativo).length,
      inactive: items.filter((i) => !i.ativo).length,
    };
  }, [listQuery.data?.items]);

  const previewHora = useMemo(() => {
    const mensal = parseMoneyInput(form.custoMensal);
    if (mensal == null) return null;
    return mensal / horasMes;
  }, [form.custoMensal, horasMes]);

  const reportError = (error: unknown) => {
    window.alert(error instanceof Error ? error.message : "Operação falhou.");
  };

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: QUERY_KEY });
  };

  const resetForm = () => {
    setForm(EMPTY_FORM);
    setEditingId(null);
  };

  const startEdit = (item: CustoFuncaoRecord) => {
    setEditingId(item.id);
    setForm({
      nome: item.nome,
      codigo: item.codigo ?? "",
      descricao: item.descricao ?? "",
      custoMensal: String(item.custo_mensal).replace(".", ","),
      quantidade: String(item.quantidade ?? 1),
      alocacao: item.alocacao === "overhead" ? "overhead" : "etapa",
    });
  };

  const createMutation = useMutation({
    mutationFn: () => {
      const mensal = parseMoneyInput(form.custoMensal);
      if (!form.nome.trim()) throw new Error("Informe o nome da função.");
      if (mensal == null) throw new Error("Informe um custo mensal válido (≥ 0).");
      const qtd = Number(form.quantidade);
      if (!Number.isFinite(qtd) || qtd < 1) throw new Error("Informe a quantidade no quadro (≥ 1).");
      return createCustoFuncao({
        nome: form.nome.trim(),
        custo_mensal: mensal,
        codigo: form.codigo.trim() || null,
        descricao: form.descricao.trim() || null,
        quantidade: Math.round(qtd),
        alocacao: form.alocacao,
      });
    },
    onSuccess: () => {
      resetForm();
      invalidate();
    },
    onError: reportError,
  });

  const updateMutation = useMutation({
    mutationFn: () => {
      if (editingId == null) throw new Error("Nenhuma função selecionada.");
      const mensal = parseMoneyInput(form.custoMensal);
      if (!form.nome.trim()) throw new Error("Informe o nome da função.");
      if (mensal == null) throw new Error("Informe um custo mensal válido (≥ 0).");
      const qtd = Number(form.quantidade);
      if (!Number.isFinite(qtd) || qtd < 1) throw new Error("Informe a quantidade no quadro (≥ 1).");
      const codigoTrim = form.codigo.trim();
      return updateCustoFuncao(editingId, {
        nome: form.nome.trim(),
        custo_mensal: mensal,
        codigo: codigoTrim || null,
        clear_codigo: !codigoTrim,
        descricao: form.descricao.trim() || null,
        quantidade: Math.round(qtd),
        alocacao: form.alocacao,
      });
    },
    onSuccess: () => {
      resetForm();
      invalidate();
    },
    onError: reportError,
  });

  const toggleMutation = useMutation({
    mutationFn: (item: CustoFuncaoRecord) =>
      item.ativo ? deactivateCustoFuncao(item.id) : activateCustoFuncao(item.id),
    onSuccess: invalidate,
    onError: reportError,
  });

  const pending =
    createMutation.isPending ||
    updateMutation.isPending ||
    toggleMutation.isPending;

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (editingId != null) {
      void updateMutation.mutate();
    } else {
      void createMutation.mutate();
    }
  };

  return (
    <ConfigSection>
      <ConfigSectionHeader
        icon={<Users className="size-4" aria-hidden />}
        title="Custos operacionais"
        description="Cadastre funções da gráfica, o efetivo e o custo mensal. O custo/hora (mensal ÷ 176 h) entra no orçamento por etapa; gerente e mecânico são overhead da estrutura."
      />
      <ConfigSectionBody>
        <ConfigSubsection tone="highlight" title="Funções (mão de obra)">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <p className="max-w-2xl text-xs leading-relaxed text-slate-600">
              Informe o custo mensal da função. O sistema deriva o custo/hora com base em{" "}
              <strong>{horasMes} horas</strong> mensais.
            </p>
            <div className="flex flex-wrap gap-2 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              <span className="rounded-full bg-white px-2 py-1 ring-1 ring-slate-200">
                {stats.total} funções
              </span>
              <span className="rounded-full bg-emerald-50 px-2 py-1 text-emerald-700 ring-1 ring-emerald-200">
                {stats.active} ativas
              </span>
              {stats.inactive > 0 ? (
                <span className="rounded-full bg-amber-50 px-2 py-1 text-amber-700 ring-1 ring-amber-200">
                  {stats.inactive} inativas
                </span>
              ) : null}
            </div>
          </div>

          <form className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4" onSubmit={onSubmit}>
            <label className="block text-xs sm:col-span-2 lg:col-span-1">
              <span className="mb-1 block font-semibold text-slate-700">Nome *</span>
              <input
                type="text"
                value={form.nome}
                onChange={(e) => setForm((f) => ({ ...f, nome: e.target.value }))}
                maxLength={120}
                required
                placeholder="Ex.: Operador Offset"
                className="h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-xs outline-none ring-secondary-blue/30 focus:ring-2"
              />
            </label>
            <label className="block text-xs">
              <span className="mb-1 block font-semibold text-slate-700">Código</span>
              <input
                type="text"
                value={form.codigo}
                onChange={(e) => setForm((f) => ({ ...f, codigo: e.target.value }))}
                maxLength={64}
                placeholder="Opcional"
                className="h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-xs outline-none ring-secondary-blue/30 focus:ring-2"
              />
            </label>
            <label className="block text-xs">
              <span className="mb-1 block font-semibold text-slate-700">Custo mensal (R$) *</span>
              <input
                type="text"
                inputMode="decimal"
                value={form.custoMensal}
                onChange={(e) => setForm((f) => ({ ...f, custoMensal: e.target.value }))}
                required
                placeholder="0,00"
                className="h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-xs outline-none ring-secondary-blue/30 focus:ring-2"
              />
            </label>
            <label className="block text-xs">
              <span className="mb-1 block font-semibold text-slate-700">Quadro (qtd) *</span>
              <input
                type="number"
                min={1}
                step={1}
                value={form.quantidade}
                onChange={(e) => setForm((f) => ({ ...f, quantidade: e.target.value }))}
                required
                className="h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-xs outline-none ring-secondary-blue/30 focus:ring-2"
              />
            </label>
            <label className="block text-xs">
              <span className="mb-1 block font-semibold text-slate-700">Alocação *</span>
              <select
                value={form.alocacao}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    alocacao: e.target.value === "overhead" ? "overhead" : "etapa",
                  }))
                }
                className="h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-xs outline-none ring-secondary-blue/30 focus:ring-2"
              >
                <option value="etapa">Etapa (trabalha no serviço)</option>
                <option value="overhead">Estrutura (gerente / mecânico)</option>
              </select>
            </label>
            <div className="block text-xs">
              <span className="mb-1 block font-semibold text-slate-700">Custo/hora (calculado)</span>
              <div className="flex h-9 items-center rounded-lg border border-slate-200 bg-slate-50 px-3 text-xs text-slate-700">
                {previewHora != null ? money(previewHora) : "—"}
              </div>
              <p className="mt-1 text-[10px] text-slate-500">
                Custo/hora = custo mensal ÷ {horasMes} h
              </p>
            </div>
            <label className="block text-xs sm:col-span-2 lg:col-span-4">
              <span className="mb-1 block font-semibold text-slate-700">Descrição</span>
              <input
                type="text"
                value={form.descricao}
                onChange={(e) => setForm((f) => ({ ...f, descricao: e.target.value }))}
                placeholder="Opcional"
                className="h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-xs outline-none ring-secondary-blue/30 focus:ring-2"
              />
            </label>
            <div className="flex flex-wrap gap-2 sm:col-span-2 lg:col-span-4">
              <button
                type="submit"
                disabled={pending || !form.nome.trim()}
                className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-primary-green px-4 text-xs font-semibold text-white hover:bg-primary-green/90 disabled:opacity-60"
              >
                {createMutation.isPending || updateMutation.isPending ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : editingId != null ? (
                  <Pencil className="size-3.5" />
                ) : (
                  <Plus className="size-3.5" />
                )}
                {editingId != null ? "Salvar alterações" : "Incluir função"}
              </button>
              {editingId != null ? (
                <button
                  type="button"
                  disabled={pending}
                  onClick={resetForm}
                  className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                >
                  <X className="size-3.5" />
                  Cancelar edição
                </button>
              ) : null}
            </div>
          </form>
        </ConfigSubsection>

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
              placeholder="Buscar função…"
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
            Mostrar inativas
          </label>
        </div>

        {listQuery.isPending ? (
          <ConfigLoadingState>
            <Loader2 className="size-4 animate-spin" />
            Carregando funções…
          </ConfigLoadingState>
        ) : null}

        {listQuery.isError ? (
          <ConfigErrorState>
            {listQuery.error instanceof Error
              ? listQuery.error.message
              : "Erro ao carregar funções."}
          </ConfigErrorState>
        ) : null}

        {!listQuery.isPending && !listQuery.isError ? (
          <div className="mt-4 overflow-hidden rounded-lg border border-slate-200">
            <div className="hidden grid-cols-[minmax(0,1.6fr)_minmax(0,0.5fr)_minmax(0,0.5fr)_minmax(0,0.7fr)_minmax(0,0.8fr)_minmax(0,0.8fr)_auto] gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-slate-500 sm:grid">
              <span>Função</span>
              <span>Código</span>
              <span>Quadro</span>
              <span>Alocação</span>
              <span>Custo mensal</span>
              <span>Custo/hora</span>
              <span>Ações</span>
            </div>

            {filtered.length === 0 ? (
              <p className="px-4 py-8 text-center text-xs text-slate-500">
                Nenhuma função cadastrada ainda.
              </p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {filtered.map((item) => (
                  <li
                    key={item.id}
                    className={cn(
                      "grid gap-2 px-3 py-2.5 sm:grid-cols-[minmax(0,1.6fr)_minmax(0,0.5fr)_minmax(0,0.5fr)_minmax(0,0.7fr)_minmax(0,0.8fr)_minmax(0,0.8fr)_auto] sm:items-center",
                      !item.ativo && "bg-slate-50/80",
                      editingId === item.id && "bg-sky-50/60",
                    )}
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={cn(
                            "text-sm font-medium",
                            item.ativo ? "text-slate-800" : "text-slate-500 line-through",
                          )}
                        >
                          {item.nome}
                        </span>
                        <span
                          className={cn(
                            "rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                            item.ativo
                              ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
                              : "bg-slate-100 text-slate-500 ring-1 ring-slate-200",
                          )}
                        >
                          {item.ativo ? "Ativa" : "Inativa"}
                        </span>
                      </div>
                      {item.descricao ? (
                        <p className="mt-0.5 truncate text-[11px] text-slate-500">
                          {item.descricao}
                        </p>
                      ) : null}
                    </div>
                    <span className="text-xs text-slate-600">{item.codigo || "—"}</span>
                    <span className="text-xs text-slate-600">{item.quantidade ?? 1}</span>
                    <span className="text-xs text-slate-600">
                      {item.alocacao === "overhead" ? "Estrutura" : "Etapa"}
                    </span>
                    <span className="text-xs font-medium text-slate-800">
                      {money(item.custo_mensal)}
                    </span>
                    <span className="text-xs text-slate-700">{money(item.custo_hora)}</span>
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => startEdit(item)}
                        title="Editar"
                        className="inline-flex size-8 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-60"
                      >
                        <Pencil className="size-3.5" aria-hidden />
                      </button>
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => void toggleMutation.mutate(item)}
                        title={item.ativo ? "Desativar" : "Ativar"}
                        className="inline-flex size-8 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-60"
                      >
                        {item.ativo ? (
                          <ToggleRight className="size-4 text-emerald-600" aria-hidden />
                        ) : (
                          <ToggleLeft className="size-4 text-slate-400" aria-hidden />
                        )}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}
      </ConfigSectionBody>
    </ConfigSection>
  );
}
