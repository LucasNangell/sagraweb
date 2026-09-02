import { cn } from "@sagra/ui";
import {
  ArrowLeft,
  ChevronsLeft,
  ChevronsRight,
  Clock,
  Loader2,
  Pencil,
  Search,
  Send,
  Trash2,
} from "lucide-react";
import { useMemo, useState } from "react";

import type {
  GravacaoPendenteControleUpdateBody,
  GravacaoPendenteFornecedorItem,
  GravacaoPendenteHistoricoItem,
  GravacaoPendenteOsItem,
} from "@/api/gravacaoPendente";
import {
  fetchGravacaoPendenteFornecedores,
  gravacaoPendenteCompositePreviewUrl,
  gravacaoPendenteDownloadUrl,
  gravacaoPendentePreviewUrl,
} from "@/api/gravacaoPendente";
import {
  useEnviarGravacaoPendenteMutation,
  useDeleteGravacaoPendenteControleMutation,
  useGravacaoPendenteDetail,
  useGravacaoPendenteHistorico,
  useGravacaoPendenteOsList,
  usePatchGravacaoPendenteControleMutation,
  usePatchGravacaoPendenteObservacaoMutation,
} from "@/api/hooks/useGravacaoPendente";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useAccessControl } from "@/features/auth/useAccessControl";
import { useAuthStore } from "@/features/auth/authStore";
import { useMatchMedia } from "@/hooks/useMatchMedia";
import { formatDateBr, formatDateTimeBr } from "@/lib/format";
import {
  formatOsCardSubtitle,
  formatOsJuntadaLabel,
} from "../utils/formatOsJuntadaLabel";
import { GravacaoFornecedorSelectModal } from "./GravacaoFornecedorSelectModal";
import { GravacaoObservacaoBox } from "./GravacaoObservacaoBox";
import { GravacaoPendenteControleEditModal } from "./GravacaoPendenteControleEditModal";
import { GravacaoPendenteHistoricoCota } from "./GravacaoPendenteHistoricoCota";
import {
  GravacaoExternaArquivosPanel,
  GravacaoExternaPreview,
  type PreviewSelection,
} from "./GravacaoExternaPreview";

function formatOsListLabel(
  item: { nr_os: number; ano: number; membros?: { nr_os: number; ano: number }[] },
): string {
  return formatOsJuntadaLabel(item.membros, item);
}

function listItemHasSession(item: GravacaoPendenteOsItem): boolean {
  return item.gravacao_pendente_status !== "sem_sessao" && item.gravacao_pendente_id != null;
}

function historicoRowKey(item: GravacaoPendenteHistoricoItem): string {
  return String(item.gravacao_pendente_id ?? item.gravacao_externa_id ?? `${item.ano}-${item.nr_os}`);
}

function PendenteStatusBadge({ status }: { status: string }) {
  const label =
    status === "ativa"
      ? "Ativa"
      : status === "enviada"
        ? "Enviada"
        : status === "sem_sessao"
          ? "Sem arquivos"
          : status;
  const className =
    status === "ativa"
      ? "bg-amber-100 text-amber-800 border-amber-200"
      : status === "enviada"
        ? "bg-emerald-100 text-emerald-800 border-emerald-200"
        : "bg-neutral-100 text-neutral-600 border-neutral-300";
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold",
        className,
      )}
    >
      {label}
    </span>
  );
}

export function GravacaoPendenteTab() {
  const { can } = useAccessControl();
  const user = useAuthStore((s) => s.user);
  const canDeleteControle = can("sb_gravacao_pendente_excluir");
  const canLancarExterna = can("sb_gravacao_externa_lancar");
  const canEditObservacao = can("sb_gravacao_pendente") && !user?.fornecedor;
  const isMobile = useMatchMedia("(max-width: 767px)");

  const currentYear = new Date().getFullYear();
  const [ano, setAno] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 300);
  const [selected, setSelected] = useState<GravacaoPendenteOsItem | null>(null);
  const [previewSelection, setPreviewSelection] = useState<PreviewSelection | null>(null);
  const [fornecedorModalOpen, setFornecedorModalOpen] = useState(false);
  const [fornecedores, setFornecedores] = useState<GravacaoPendenteFornecedorItem[]>([]);
  const [controleExpanded, setControleExpanded] = useState(false);
  const [editingControleItem, setEditingControleItem] =
    useState<GravacaoPendenteHistoricoItem | null>(null);
  const patchControleMutation = usePatchGravacaoPendenteControleMutation();
  const patchObservacaoMutation = usePatchGravacaoPendenteObservacaoMutation();
  const deleteControleMutation = useDeleteGravacaoPendenteControleMutation();

  const listQuery = useGravacaoPendenteOsList({
    ano: ano ?? undefined,
    search: debouncedSearch || undefined,
  });
  const historicoQuery = useGravacaoPendenteHistorico(100);

  const formatChapas = (item: GravacaoPendenteHistoricoItem) =>
    item.chapas_por_maquina?.length
      ? item.chapas_por_maquina.map((c) => `${c.maquina}: ${c.quantidade}`).join(" · ")
      : "—";

  const handleSaveControle = async (body: GravacaoPendenteControleUpdateBody) => {
    if (editingControleItem?.gravacao_pendente_id == null) return;
    await patchControleMutation.mutateAsync({
      gravacaoPendenteId: editingControleItem.gravacao_pendente_id,
      body,
    });
    setEditingControleItem(null);
  };

  const handleDeleteControle = async (item: GravacaoPendenteHistoricoItem) => {
    if (item.gravacao_pendente_id == null) return;
    const confirmed = window.confirm(
      `Excluir permanentemente o lançamento da OS ${formatOsListLabel(item)} do controle de chapas?\n\nA cota será recalculada. Esta ação não pode ser desfeita.`,
    );
    if (!confirmed) return;
    try {
      await deleteControleMutation.mutateAsync(item.gravacao_pendente_id);
    } catch (error) {
      window.alert(
        error instanceof Error ? error.message : "Não foi possível excluir o lançamento.",
      );
    }
  };

  const selectedHasSession = selected != null && listItemHasSession(selected);

  const detailQuery = useGravacaoPendenteDetail(
    selected?.ano ?? null,
    selected?.nr_os ?? null,
    selectedHasSession,
  );

  const enviarMutation = useEnviarGravacaoPendenteMutation();

  const detail = detailQuery.data;
  const arquivos = detail?.arquivos ?? [];
  const chapas = detail?.chapas ?? [];

  const years = useMemo(() => {
    const ys: number[] = [];
    for (let y = currentYear; y >= currentYear - 5; y -= 1) {
      ys.push(y);
    }
    return ys;
  }, [currentYear]);

  const handleSelectOs = (item: GravacaoPendenteOsItem) => {
    setSelected(item);
    setPreviewSelection(null);
  };

  const doEnviar = async (fornecedorPonto?: string) => {
    if (!selected) return;
    try {
      await enviarMutation.mutateAsync({
        ano: selected.ano,
        nrOs: selected.nr_os,
        fornecedorPonto,
      });
      window.alert("OS enviada para Gravação Externa.");
      setSelected(null);
      setPreviewSelection(null);
      setFornecedorModalOpen(false);
      setFornecedores([]);
    } catch (e) {
      window.alert(
        e instanceof Error ? e.message : "Não foi possível enviar para Gravação Externa.",
      );
    }
  };

  const handleEnviar = async () => {
    if (!selected) {
      return;
    }
    if (
      !window.confirm(
        `Enviar OS ${formatOsListLabel(selected)} para Gravação Externa?`,
      )
    ) {
      return;
    }

    try {
      const res = await fetchGravacaoPendenteFornecedores();
      const items = res.items ?? [];
      if (items.length === 0) {
        window.alert(
          "Nenhum fornecedor cadastrado. Cadastre um usuário com flag Fornecedor.",
        );
        return;
      }
      if (items.length === 1) {
        await doEnviar(items[0].ponto);
        return;
      }
      setFornecedores(items);
      setFornecedorModalOpen(true);
    } catch (e) {
      window.alert(
        e instanceof Error ? e.message : "Não foi possível carregar fornecedores.",
      );
    }
  };

  const listPanel = (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 space-y-2 border-b border-neutral-200 p-3">
        <div className="flex gap-2">
          <select
            value={ano ?? ""}
            onChange={(e) => {
              const value = e.target.value;
              setAno(value === "" ? null : Number(value));
            }}
            className="rounded border border-neutral-300 px-2 py-1.5 text-sm"
            aria-label="Filtrar por ano"
          >
            <option value="">Todos os anos</option>
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-neutral-400" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar OS, solicitante…"
              className="w-full rounded border border-neutral-300 py-1.5 pl-8 pr-2 text-sm"
            />
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {listQuery.isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="size-6 animate-spin text-primary-green" />
          </div>
        ) : listQuery.isError ? (
          <p className="p-4 text-sm text-red-600">Erro ao carregar a lista.</p>
        ) : (listQuery.data?.items.length ?? 0) === 0 ? (
          <p className="p-4 text-center text-sm text-neutral-500">
            Nenhuma OS com andamento Gravação Pendente.
          </p>
        ) : (
          <ul className="space-y-1">
            {listQuery.data?.items.map((item) => {
              const active =
                selected?.nr_os === item.nr_os && selected?.ano === item.ano;
              return (
                <li key={`${item.ano}-${item.nr_os}`}>
                  <button
                    type="button"
                    onClick={() => handleSelectOs(item)}
                    className={cn(
                      "w-full rounded-lg border px-3 py-2.5 text-left transition-colors",
                      active
                        ? "border-primary-green bg-primary-green/10"
                        : "border-neutral-200 bg-white hover:border-neutral-300",
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-neutral-900">
                        {formatOsListLabel(item)}
                      </span>
                      <PendenteStatusBadge status={item.gravacao_pendente_status} />
                    </div>
                    <p className="mt-0.5 truncate text-xs text-neutral-600">
                      {formatOsCardSubtitle(item)}
                    </p>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );

  const detailPanel = !selected ? (
    <div className="flex h-full items-center justify-center p-8 text-center text-sm text-neutral-500">
      Selecione uma OS na lista para ver arquivos e chapas.
    </div>
  ) : !selectedHasSession ? (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
      <p className="text-sm text-neutral-600">
        Esta OS está em Gravação Pendente, mas ainda não há arquivos vinculados.
      </p>
      <p className="text-xs text-neutral-500">
        Relance o andamento na página da OS selecionando os arquivos na rede e
        informando as chapas por máquina.
      </p>
    </div>
  ) : detailQuery.isLoading ? (
    <div className="flex h-full items-center justify-center">
      <Loader2 className="size-8 animate-spin text-primary-green" />
    </div>
  ) : detailQuery.isError || !detail ? (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
      <p className="text-sm text-neutral-600">Não foi possível carregar os detalhes.</p>
    </div>
  ) : (
    <div className="flex h-full min-h-0 min-w-0 flex-col gap-3 overflow-hidden p-3 md:p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            {isMobile && (
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="inline-flex items-center gap-1 rounded border border-neutral-300 px-2 py-1 text-xs"
              >
                <ArrowLeft className="size-3.5" />
                Voltar
              </button>
            )}
            <h2 className="text-lg font-semibold text-neutral-900">
              OS {formatOsListLabel(selected)}
            </h2>
            <PendenteStatusBadge status={detail.status} />
          </div>
          <p className="mt-1 text-sm text-neutral-600">
            {selected.solicitante}
            {selected.produto ? ` · ${selected.produto}` : ""}
          </p>
          <p className="text-xs text-neutral-500">
            Lançado por {detail.lancado_por_nome || detail.lancado_por_ponto}
          </p>
        </div>
        {detail.status === "ativa" && canLancarExterna ? (
          <button
            type="button"
            disabled={enviarMutation.isPending}
            onClick={() => void handleEnviar()}
            className="inline-flex items-center gap-2 rounded bg-primary-green px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {enviarMutation.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Send className="size-4" />
            )}
            Enviar para gravação externa
          </button>
        ) : null}
      </div>

      {chapas.length > 0 ? (
        <div className="rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
            Chapas
          </h3>
          <ul className="mt-1 flex flex-wrap gap-2 text-sm text-neutral-800">
            {chapas.map((c) => (
              <li
                key={c.id}
                className="rounded-full border border-neutral-300 bg-white px-2.5 py-0.5"
              >
                {c.maquina}: <strong>{c.quantidade}</strong>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="grid min-h-0 min-w-0 flex-1 grid-cols-1 gap-3 overflow-hidden lg:grid-cols-[minmax(200px,28%)_minmax(0,1fr)]">
        <div className="flex min-h-[200px] min-w-0 flex-col gap-2 overflow-hidden lg:min-h-0">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
            Arquivos ({arquivos.length})
          </h3>
          <GravacaoObservacaoBox
            observacao={detail.observacao}
            editable={canEditObservacao}
            saving={patchObservacaoMutation.isPending}
            onSave={async (text) => {
              try {
                await patchObservacaoMutation.mutateAsync({
                  ano: selected.ano,
                  nrOs: selected.nr_os,
                  observacao: text,
                });
              } catch (error) {
                window.alert(
                  error instanceof Error
                    ? error.message
                    : "Não foi possível salvar a observação.",
                );
                throw error;
              }
            }}
          />
          <div className="min-h-0 flex-1 overflow-y-auto">
            <GravacaoExternaArquivosPanel
              ano={selected.ano}
              nrOs={selected.nr_os}
              arquivos={arquivos}
              selection={previewSelection}
              groupByMachine
              chapasPorMaquina={chapas}
              onSelect={(arq) => setPreviewSelection({ kind: "file", arquivo: arq })}
              onSelectComposite={(chapa) =>
                setPreviewSelection({
                  kind: "composite",
                  groupKey: chapa.groupKey,
                  chapaLabel: chapa.chapaLabel,
                  displayLabel: chapa.displayLabel,
                })
              }
              getDownloadUrl={gravacaoPendenteDownloadUrl}
            />
          </div>
        </div>
        <div className="flex min-h-[280px] min-w-0 flex-col overflow-hidden lg:min-h-0 lg:h-full">
          <GravacaoExternaPreview
            ano={selected.ano}
            nrOs={selected.nr_os}
            selection={previewSelection}
            getPreviewUrl={gravacaoPendentePreviewUrl}
            getCompositePreviewUrl={gravacaoPendenteCompositePreviewUrl}
            getDownloadUrl={gravacaoPendenteDownloadUrl}
          />
        </div>
      </div>
    </div>
  );

  const historicoPanel = (
    <section className="flex h-full min-h-0 flex-col bg-white">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-neutral-200 px-3 py-2">
        <div className="flex items-center gap-2">
          <Clock className="size-4 text-neutral-500" />
          <h3 className="text-sm font-semibold text-neutral-800">
            Controle de chapas gravadas
          </h3>
        </div>
        {!isMobile ? (
          <button
            type="button"
            onClick={() => setControleExpanded((v) => !v)}
            className="inline-flex items-center gap-1 rounded border border-neutral-300 bg-white px-2 py-1 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
            aria-expanded={controleExpanded}
            aria-label={
              controleExpanded
                ? "Recolher lista de controle"
                : "Expandir lista de controle"
            }
            title={controleExpanded ? "Recolher" : "Expandir lista"}
          >
            {controleExpanded ? (
              <>
                <ChevronsRight className="size-3.5" />
                Recolher
              </>
            ) : (
              <>
                <ChevronsLeft className="size-3.5" />
                Expandir
              </>
            )}
          </button>
        ) : null}
      </div>
      <GravacaoPendenteHistoricoCota
        maquinas={historicoQuery.data?.maquinas}
        totalGravadas={historicoQuery.data?.total_chapas_geral ?? 0}
        restantes={historicoQuery.data?.chapas_restantes ?? 0}
        loading={historicoQuery.isLoading}
      />
      <div className="min-h-0 flex-1 overflow-auto">
        {historicoQuery.isLoading ? (
          <p className="px-3 py-4 text-center text-xs text-neutral-500">Carregando…</p>
        ) : (historicoQuery.data?.items.length ?? 0) === 0 ? (
          <p className="px-3 py-4 text-center text-xs text-neutral-500">
            Nenhuma OS no controle de chapas.
          </p>
        ) : (
          <table className="w-full border-collapse text-xs">
            <thead className="sticky top-0 z-[1] bg-slate-100">
              <tr>
                <th className="whitespace-nowrap px-2 py-1.5 text-left font-semibold">OS/Ano</th>
                {controleExpanded ? (
                  <>
                    <th className="whitespace-nowrap px-2 py-1.5 text-left font-semibold">
                      Cliente
                    </th>
                    <th className="whitespace-nowrap px-2 py-1.5 text-left font-semibold">
                      Título
                    </th>
                    <th className="whitespace-nowrap px-2 py-1.5 text-left font-semibold">
                      Chapas / máquina
                    </th>
                    <th className="whitespace-nowrap px-2 py-1.5 text-left font-semibold">
                      Disp. p/ Gravação
                    </th>
                    <th className="whitespace-nowrap px-2 py-1.5 text-left font-semibold">
                      Saída p/ Birô
                    </th>
                    <th className="whitespace-nowrap px-2 py-1.5 text-left font-semibold">
                      Fornecedor
                    </th>
                    <th className="whitespace-nowrap px-2 py-1.5 text-left font-semibold">
                      Grav. Concluída
                    </th>
                    <th className="whitespace-nowrap px-2 py-1.5 text-left font-semibold">
                      Receb. CGRAF
                    </th>
                    <th className="whitespace-nowrap px-2 py-1.5 text-left font-semibold">
                      Recebido por
                    </th>
                    <th className="whitespace-nowrap px-2 py-1.5 text-left font-semibold">
                      Pagamento NF
                    </th>
                    <th className="px-2 py-1.5 text-center font-semibold">Ações</th>
                  </>
                ) : (
                  <>
                    <th className="px-2 py-1.5 text-left font-semibold">Cliente</th>
                    <th className="px-2 py-1.5 text-right font-semibold">Total</th>
                    <th className="px-2 py-1.5 text-left font-semibold">Grav. Concluída</th>
                    <th className="px-2 py-1.5 text-center font-semibold">Ações</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {historicoQuery.data?.items.map((item) => {
                const fornecedorLabel =
                  item.fornecedor_nome?.trim() || item.fornecedor_ponto || "—";
                const recebidoLabel =
                  item.recebido_por_nome?.trim() || item.recebido_por_ponto || "—";
                const canEditControle = item.gravacao_pendente_id != null;
                return (
                  <tr key={historicoRowKey(item)} className="border-b border-neutral-100">
                    <td className="whitespace-nowrap px-2 py-1 font-medium">
                      {formatOsListLabel(item)}
                    </td>
                    {controleExpanded ? (
                      <>
                        <td className="max-w-[10rem] truncate px-2 py-1" title={item.solicitante || undefined}>
                          {item.solicitante || "—"}
                        </td>
                        <td className="max-w-[12rem] truncate px-2 py-1" title={item.titulo || undefined}>
                          {item.titulo || "—"}
                        </td>
                        <td className="max-w-[14rem] px-2 py-1" title={formatChapas(item)}>
                          {formatChapas(item)}
                        </td>
                        <td className="whitespace-nowrap px-2 py-1">
                          {formatDateTimeBr(item.criado_em) || "—"}
                        </td>
                        <td className="whitespace-nowrap px-2 py-1">
                          {formatDateTimeBr(item.enviada_em) || "—"}
                        </td>
                        <td className="max-w-[10rem] truncate px-2 py-1" title={fornecedorLabel}>
                          {fornecedorLabel}
                        </td>
                        <td className="whitespace-nowrap px-2 py-1">
                          {formatDateTimeBr(item.concluida_em) || "—"}
                        </td>
                        <td className="whitespace-nowrap px-2 py-1">
                          {formatDateTimeBr(item.entrega_lancada_em) || "—"}
                        </td>
                        <td className="max-w-[10rem] truncate px-2 py-1" title={recebidoLabel}>
                          {recebidoLabel}
                        </td>
                        <td className="whitespace-nowrap px-2 py-1">
                          {formatDateBr(item.pagamento_nf_em) || "—"}
                        </td>
                        <td className="px-2 py-1 text-center">
                          <div className="inline-flex items-center justify-center gap-0.5">
                            <button
                              type="button"
                              aria-label={`Editar controle OS ${formatOsListLabel(item)}`}
                              disabled={!canEditControle || patchControleMutation.isPending}
                              onClick={() => setEditingControleItem(item)}
                              className="rounded p-1 text-sky-700 hover:bg-sky-50 disabled:opacity-40"
                            >
                              <Pencil className="size-3.5" />
                            </button>
                            {canDeleteControle ? (
                              <button
                                type="button"
                                aria-label={`Excluir controle OS ${formatOsListLabel(item)}`}
                                disabled={
                                  item.gravacao_pendente_id == null ||
                                  deleteControleMutation.isPending
                                }
                                onClick={() => void handleDeleteControle(item)}
                                className="rounded p-1 text-red-700 hover:bg-red-50 disabled:opacity-40"
                              >
                                <Trash2 className="size-3.5" />
                              </button>
                            ) : null}
                          </div>
                        </td>
                      </>
                    ) : (
                      <>
                        <td
                          className="max-w-[7rem] truncate px-2 py-1"
                          title={item.solicitante || undefined}
                        >
                          {item.solicitante || "—"}
                        </td>
                        <td className="px-2 py-1 text-right tabular-nums">
                          {item.total_chapas}
                        </td>
                        <td className="px-2 py-1">
                          {formatDateBr(item.concluida_em) || "—"}
                        </td>
                        <td className="px-2 py-1 text-center">
                          <div className="inline-flex items-center justify-center gap-0.5">
                            <button
                              type="button"
                              aria-label={`Editar controle OS ${formatOsListLabel(item)}`}
                              disabled={!canEditControle || patchControleMutation.isPending}
                              onClick={() => setEditingControleItem(item)}
                              className="rounded p-1 text-sky-700 hover:bg-sky-50 disabled:opacity-40"
                            >
                              <Pencil className="size-3.5" />
                            </button>
                            {canDeleteControle ? (
                              <button
                                type="button"
                                aria-label={`Excluir controle OS ${formatOsListLabel(item)}`}
                                disabled={
                                  item.gravacao_pendente_id == null ||
                                  deleteControleMutation.isPending
                                }
                                onClick={() => void handleDeleteControle(item)}
                                className="rounded p-1 text-red-700 hover:bg-red-50 disabled:opacity-40"
                              >
                                <Trash2 className="size-3.5" />
                              </button>
                            ) : null}
                          </div>
                        </td>
                      </>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );

  return (
    <>
      {isMobile ? (
        <div className="flex h-full min-h-0 flex-col">
          <div className="min-h-0 flex-1">
            {selected ? detailPanel : listPanel}
          </div>
          {!selected ? (
            <div className="max-h-[45%] min-h-[180px] border-t border-neutral-200">
              {historicoPanel}
            </div>
          ) : null}
        </div>
      ) : (
        <div className="relative flex h-full min-h-0">
          <aside className="z-10 w-full max-w-sm shrink-0 border-r border-neutral-200 bg-white">
            {listPanel}
          </aside>
          <main className="min-w-0 flex-1">{detailPanel}</main>
          <aside
            className={cn(
              "flex flex-col border-l border-neutral-200 bg-white transition-[box-shadow] duration-200",
              controleExpanded
                ? "absolute inset-y-0 right-0 left-96 z-20 shadow-2xl"
                : "relative w-full max-w-sm shrink-0",
            )}
          >
            {historicoPanel}
          </aside>
        </div>
      )}

      <GravacaoFornecedorSelectModal
        open={fornecedorModalOpen}
        fornecedores={fornecedores}
        saving={enviarMutation.isPending}
        onClose={() => {
          setFornecedorModalOpen(false);
          setFornecedores([]);
        }}
        onConfirm={(ponto) => void doEnviar(ponto)}
      />

      <GravacaoPendenteControleEditModal
        open={editingControleItem != null}
        item={editingControleItem}
        saving={patchControleMutation.isPending}
        onClose={() => setEditingControleItem(null)}
        onSave={handleSaveControle}
      />
    </>
  );
}
