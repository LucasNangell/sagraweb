import { cn } from "@sagra/ui";
import { ArrowLeft, CheckCircle2, Loader2, PackageCheck, Search } from "lucide-react";
import { useMemo, useState } from "react";

import type { GravacaoExternaOsItem } from "@/api/gravacaoExterna";
import { gravacaoExternaDownloadAllUrl } from "@/api/gravacaoExterna";
import {
  useConcluirGravacaoExternaMutation,
  GRAVACAO_EXTERNA_SAFETY_POLL_MS,
  useGravacaoExternaAguardandoEntrega,
  useGravacaoExternaDetail,
  useGravacaoExternaOsList,
  useIniciarGravacaoExternaMutation,
  useLancarEntregaChapasMutation,
} from "@/api/hooks/useGravacaoExterna";
import { useAuthStore } from "@/features/auth/authStore";
import { useAccessControl } from "@/features/auth/useAccessControl";
import {
  downloadGravacaoExternaZipAll,
  type DownloadAllPhase,
} from "@/features/gravacao-externa/utils/downloadGravacaoExternaZipAll";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useMatchMedia } from "@/hooks/useMatchMedia";
import {
  formatOsCardSubtitle,
  formatOsJuntadaLabel,
} from "../utils/formatOsJuntadaLabel";
import { GravacaoExternaActions, GravacaoExternaStatusBadge } from "./GravacaoExternaActions";
import { GravacaoExternaChatPanel } from "./GravacaoExternaChatPanel";
import { GravacaoExternaEntregaModal } from "./GravacaoExternaEntregaModal";
import {
  GravacaoExternaArquivosPanel,
  GravacaoExternaPreview,
  type PreviewSelection,
} from "./GravacaoExternaPreview";
import { useGravacaoExternaRealtime } from "../hooks/useGravacaoExternaRealtime";

type ExternaListSegment = "em_andamento" | "aguardando_entrega";

function formatOsListLabel(item: GravacaoExternaOsItem): string {
  return formatOsJuntadaLabel(item.membros, item);
}

function listItemHasSession(item: GravacaoExternaOsItem): boolean {
  return item.gravacao_status !== "sem_sessao" && item.gravacao_externa_id != null;
}

function GravacaoRealtimeToast({
  message,
  onClear,
}: {
  message: string | null;
  onClear: () => void;
}) {
  if (!message) {
    return null;
  }
  return (
    <div
      className="pointer-events-auto fixed bottom-4 right-4 z-[10010] max-w-sm rounded-lg bg-amber-600 px-4 py-3 text-sm font-semibold text-white shadow-lg"
      role="status"
    >
      <p>{message}</p>
      <button
        type="button"
        onClick={onClear}
        className="mt-2 text-xs font-medium underline opacity-90"
      >
        OK
      </button>
    </div>
  );
}

export function GravacaoExternaTab() {
  const user = useAuthStore((s) => s.user);
  const { can } = useAccessControl();
  const canOperate = can("sb_gravacao_externa_operador") || Boolean(user?.fornecedor);
  const canConcluirSemSessao = can("sb_gravacao_externa_operador");
  const canDownload = canOperate;
  const canLancarRecebimento = can("sb_gravacao_externa_entrega");
  const ponto = user?.ponto != null ? String(user.ponto) : null;
  const isMobile = useMatchMedia("(max-width: 767px)");

  const currentYear = new Date().getFullYear();
  const [ano, setAno] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 300);
  const [segment, setSegment] = useState<ExternaListSegment>("em_andamento");
  const [selected, setSelected] = useState<GravacaoExternaOsItem | null>(null);
  const [previewSelection, setPreviewSelection] = useState<PreviewSelection | null>(null);
  const [downloadPhase, setDownloadPhase] = useState<DownloadAllPhase>("idle");
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [entregaModalOpen, setEntregaModalOpen] = useState(false);

  const listFilters = {
    ano: ano ?? undefined,
    search: debouncedSearch || undefined,
  };

  const andamentoQuery = useGravacaoExternaOsList(
    listFilters,
    segment === "em_andamento",
    { refetchInterval: GRAVACAO_EXTERNA_SAFETY_POLL_MS },
  );

  const aguardandoQuery = useGravacaoExternaAguardandoEntrega(
    listFilters,
    segment === "aguardando_entrega",
    { refetchInterval: GRAVACAO_EXTERNA_SAFETY_POLL_MS },
  );

  const listQuery = segment === "em_andamento" ? andamentoQuery : aguardandoQuery;
  const isAguardando = segment === "aguardando_entrega";

  const selectedHasSession = selected != null && listItemHasSession(selected);

  const detailQuery = useGravacaoExternaDetail(
    selected?.ano ?? null,
    selected?.nr_os ?? null,
    selectedHasSession && !isAguardando,
    { refetchInterval: GRAVACAO_EXTERNA_SAFETY_POLL_MS },
  );

  const iniciarMutation = useIniciarGravacaoExternaMutation();
  const concluirMutation = useConcluirGravacaoExternaMutation();
  const entregaMutation = useLancarEntregaChapasMutation();

  const { toast, clearToast } = useGravacaoExternaRealtime(
    selected?.ano ?? null,
    selected?.nr_os ?? null,
    Boolean(ponto) && !isAguardando,
    ponto,
    {
      chatAno: selectedHasSession && !isAguardando ? selected?.ano ?? null : null,
      chatNrOs: selectedHasSession && !isAguardando ? selected?.nr_os ?? null : null,
    },
  );

  const detail = detailQuery.data;
  const arquivos = detail?.arquivos ?? [];

  const years = useMemo(() => {
    const ys: number[] = [];
    for (let y = currentYear; y >= currentYear - 5; y -= 1) {
      ys.push(y);
    }
    return ys;
  }, [currentYear]);

  const handleSelectOs = (item: GravacaoExternaOsItem) => {
    setSelected(item);
    setPreviewSelection(null);
    setDownloadPhase("idle");
    setDownloadError(null);
    setEntregaModalOpen(false);
  };

  const handleSegmentChange = (next: ExternaListSegment) => {
    setSegment(next);
    setSelected(null);
    setPreviewSelection(null);
    setEntregaModalOpen(false);
  };

  const handleIniciar = async () => {
    if (!selected) return;
    try {
      await iniciarMutation.mutateAsync({
        ano: selected.ano,
        nrOs: selected.nr_os,
      });
    } catch (e) {
      window.alert(
        e instanceof Error ? e.message : "Não foi possível iniciar a gravação.",
      );
    }
  };

  const handleConcluir = async () => {
    if (!selected) return;
    if (!window.confirm("Confirmar conclusão da Gravação Externa desta OS?")) {
      return;
    }
    try {
      await concluirMutation.mutateAsync({
        ano: selected.ano,
        nrOs: selected.nr_os,
      });
      setSelected(null);
      setPreviewSelection(null);
      window.alert("Gravação Externa concluída.");
    } catch (e) {
      window.alert(
        e instanceof Error ? e.message : "Não foi possível concluir a gravação.",
      );
    }
  };

  const handleEntrega = async (payload: {
    recebidoPorPonto: string;
    recebidoPorNome: string;
  }) => {
    if (!selected) return;
    try {
      await entregaMutation.mutateAsync({
        ano: selected.ano,
        nrOs: selected.nr_os,
        recebidoPorPonto: payload.recebidoPorPonto,
        recebidoPorNome: payload.recebidoPorNome,
      });
      window.alert("Recebimento das chapas lançado.");
      setEntregaModalOpen(false);
      setSelected(null);
    } catch (e) {
      window.alert(
        e instanceof Error ? e.message : "Não foi possível lançar o recebimento.",
      );
    }
  };

  const downloadBusy =
    downloadPhase === "preparing" || downloadPhase === "saving";

  const handleDownloadAll = async () => {
    if (!selected || downloadBusy) return;
    setDownloadError(null);
    const url = gravacaoExternaDownloadAllUrl(selected.ano, selected.nr_os);
    const fallbackFilename = `gravacao_externa_OS_${String(selected.nr_os).padStart(5, "0")}_${selected.ano}.zip`;
    try {
      await downloadGravacaoExternaZipAll(url, {
        fallbackFilename,
        onPhase: (phase) => {
          setDownloadPhase(phase);
          if (phase === "started") {
            window.setTimeout(() => {
              setDownloadPhase((current) => (current === "started" ? "idle" : current));
            }, 4000);
          }
        },
      });
      // Download auto-inicia a gravação no backend; refresca status dos botões.
      void detailQuery.refetch();
      void andamentoQuery.refetch();
    } catch (e) {
      setDownloadPhase("error");
      setDownloadError(
        e instanceof Error ? e.message : "Não foi possível baixar os arquivos.",
      );
    }
  };

  const listPanel = (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 space-y-2 border-b border-neutral-200 p-3">
        <div
          className="flex rounded-lg border border-neutral-200 bg-neutral-50 p-0.5"
          role="tablist"
          aria-label="Lista de gravação externa"
        >
          <button
            type="button"
            role="tab"
            aria-selected={segment === "em_andamento"}
            onClick={() => handleSegmentChange("em_andamento")}
            className={cn(
              "flex-1 rounded-md px-2 py-1.5 text-xs font-semibold transition-colors",
              segment === "em_andamento"
                ? "bg-white text-primary-green shadow-sm"
                : "text-neutral-600 hover:text-neutral-800",
            )}
          >
            Gravação pendente
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={segment === "aguardando_entrega"}
            onClick={() => handleSegmentChange("aguardando_entrega")}
            className={cn(
              "flex-1 rounded-md px-2 py-1.5 text-xs font-semibold transition-colors",
              segment === "aguardando_entrega"
                ? "bg-white text-primary-green shadow-sm"
                : "text-neutral-600 hover:text-neutral-800",
            )}
          >
            Aguardando retirada
          </button>
        </div>
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
            {isAguardando
              ? "Nenhuma OS aguardando entrega de chapas."
              : "Nenhuma OS em Gravação Externa (setor Grav. Externa)."}
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
                      <GravacaoExternaStatusBadge
                        status={isAguardando ? "concluida" : item.gravacao_status}
                      />
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

  const aguardandoDetailPanel = !selected ? (
    <div className="flex h-full items-center justify-center p-8 text-center text-sm text-neutral-500">
      Selecione uma OS concluída para lançar o recebimento das chapas.
    </div>
  ) : (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto p-3 md:p-4">
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
            <GravacaoExternaStatusBadge status="concluida" />
          </div>
          <p className="mt-1 text-sm text-neutral-600">
            {selected.solicitante}
            {selected.produto ? ` · ${selected.produto}` : ""}
          </p>
          {selected.fornecedor_ponto ? (
            <p className="text-xs text-neutral-500">
              Fornecedor: {selected.fornecedor_ponto}
            </p>
          ) : null}
        </div>
        {canLancarRecebimento && (
          <button
            type="button"
            onClick={() => setEntregaModalOpen(true)}
            disabled={entregaMutation.isPending}
            className="inline-flex items-center gap-2 rounded bg-primary-green px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {entregaMutation.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <PackageCheck className="size-4" />
            )}
            Lançar recebimento das chapas
          </button>
        )}
      </div>

      {(selected.chapas_por_maquina?.length ?? 0) > 0 ? (
        <div className="rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
            Chapas
          </h3>
          <ul className="mt-1 flex flex-wrap gap-2 text-sm text-neutral-800">
            {selected.chapas_por_maquina?.map((c) => (
              <li
                key={c.maquina}
                className="rounded-full border border-neutral-300 bg-white px-2.5 py-0.5"
              >
                {c.maquina}: <strong>{c.quantidade}</strong>
              </li>
            ))}
          </ul>
          {selected.total_chapas != null ? (
            <p className="mt-1 text-xs text-neutral-500">Total: {selected.total_chapas}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );

  const detailPanel = isAguardando
    ? aguardandoDetailPanel
    : !selected ? (
    <div className="flex h-full items-center justify-center p-8 text-center text-sm text-neutral-500">
      Selecione uma OS na lista para ver arquivos e mensagens.
    </div>
  ) : !selectedHasSession ? (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
      <div className="flex flex-col items-center gap-2">
        <p className="text-sm text-neutral-600">
          Esta OS está em Gravação Externa, mas ainda não há arquivos vinculados.
        </p>
        <p className="text-xs text-neutral-500">
          Envie a OS a partir de Gravação Pendente ou altere os arquivos no
          histórico da OS quando a sessão estiver disponível.
        </p>
      </div>
      {canConcluirSemSessao ? (
        <button
          type="button"
          disabled={concluirMutation.isPending}
          onClick={() => void handleConcluir()}
          className="inline-flex items-center gap-2 rounded border border-primary-green bg-white px-4 py-2 text-sm font-medium text-primary-green hover:bg-primary-green/5 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {concluirMutation.isPending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <CheckCircle2 className="size-4" />
          )}
          Gravação concluída
        </button>
      ) : null}
    </div>
  ) : detailQuery.isLoading ? (
    <div className="flex h-full items-center justify-center">
      <Loader2 className="size-8 animate-spin text-primary-green" />
    </div>
  ) : detailQuery.isError || !detail ? (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
      <p className="text-sm text-neutral-600">Não foi possível carregar os detalhes.</p>
      <p className="text-xs text-neutral-500">
        {detailQuery.error instanceof Error
          ? detailQuery.error.message
          : "Tente atualizar a página ou selecionar outra OS."}
      </p>
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
            <GravacaoExternaStatusBadge status={detail.status} />
          </div>
          <p className="mt-1 text-sm text-neutral-600">
            {selected.solicitante}
            {selected.produto ? ` · ${selected.produto}` : ""}
          </p>
          <p className="text-xs text-neutral-500">
            Lançado por {detail.lancado_por_nome || detail.lancado_por_ponto}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <GravacaoExternaActions
            detail={detail}
            canOperate={canOperate}
            onIniciar={() => void handleIniciar()}
            onConcluir={() => void handleConcluir()}
            iniciando={iniciarMutation.isPending}
            concluindo={concluirMutation.isPending}
          />
        </div>
      </div>

      <div className="grid min-h-0 min-w-0 flex-1 grid-cols-1 gap-3 overflow-hidden lg:grid-cols-[minmax(200px,28%)_minmax(0,1fr)]">
        <div className="flex min-h-[200px] min-w-0 flex-col gap-2 overflow-hidden lg:min-h-0">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
              Arquivos ({arquivos.length})
            </h3>
            {arquivos.length > 0 && canDownload ? (
              <button
                type="button"
                disabled={downloadBusy}
                onClick={() => void handleDownloadAll()}
                className="inline-flex items-center gap-1 rounded border border-neutral-300 bg-white px-2 py-1 text-xs font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-60"
                title="Baixar todos os arquivos em ZIP"
              >
                {downloadBusy ? (
                  <Loader2 className="size-3.5 animate-spin" aria-hidden />
                ) : null}
                {downloadBusy ? "Preparando…" : "Baixar todos"}
              </button>
            ) : null}
          </div>
          {downloadPhase === "preparing" || downloadPhase === "saving" ? (
            <div
              className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950"
              role="status"
              aria-live="polite"
            >
              <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-amber-700" />
              <p>
                <span className="font-semibold">Preparando arquivos para download…</span>{" "}
                Volumes grandes podem levar vários minutos.
              </p>
            </div>
          ) : null}
          {downloadPhase === "started" ? (
            <div
              className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900"
              role="status"
              aria-live="polite"
            >
              Download iniciado pelo navegador. Acompanhe a barra de downloads do
              navegador.
            </div>
          ) : null}
          {downloadPhase === "error" && downloadError ? (
            <div
              className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800"
              role="alert"
            >
              {downloadError}
            </div>
          ) : null}
          <div className="min-h-0 flex-1 overflow-y-auto">
            <GravacaoExternaArquivosPanel
              ano={selected.ano}
              nrOs={selected.nr_os}
              arquivos={arquivos}
              selection={previewSelection}
              groupByMachine
              chapasPorMaquina={selected.chapas_por_maquina ?? []}
              canDownload={canDownload}
              onSelect={(arq) => setPreviewSelection({ kind: "file", arquivo: arq })}
              onSelectComposite={(chapa) =>
                setPreviewSelection({
                  kind: "composite",
                  groupKey: chapa.groupKey,
                  chapaLabel: chapa.chapaLabel,
                  displayLabel: chapa.displayLabel,
                })
              }
            />
          </div>
        </div>
        <div className="flex min-h-[280px] min-w-0 flex-col overflow-hidden lg:min-h-0 lg:h-full">
          <GravacaoExternaPreview
            ano={selected.ano}
            nrOs={selected.nr_os}
            selection={previewSelection}
            canDownload={canDownload}
          />
        </div>
      </div>

      {isMobile ? (
        <GravacaoExternaChatPanel
          ano={selected.ano}
          nrOs={selected.nr_os}
          currentPonto={ponto}
          realtimeOwnedExternally
        />
      ) : null}
    </div>
  );

  const chatSidebar = isAguardando ? (
    <div className="flex h-full items-center justify-center p-4 text-center text-sm text-neutral-500">
      Chat disponível na lista Gravação pendente.
    </div>
  ) : !selected ? (
    <div className="flex h-full items-center justify-center p-4 text-center text-sm text-neutral-500">
      Selecione uma OS na lista para ver as mensagens.
    </div>
  ) : !selectedHasSession ? (
    <div className="flex h-full items-center justify-center p-4 text-center text-sm text-neutral-500">
      Mensagens disponíveis quando a OS tiver arquivos vinculados.
    </div>
  ) : detailQuery.isLoading ? (
    <div className="flex h-full items-center justify-center">
      <Loader2 className="size-6 animate-spin text-primary-green" />
    </div>
  ) : detailQuery.isError || !detail ? (
    <div className="flex h-full items-center justify-center p-4 text-center text-sm text-neutral-500">
      Não foi possível carregar as mensagens.
    </div>
  ) : (
    <GravacaoExternaChatPanel
      ano={selected.ano}
      nrOs={selected.nr_os}
      currentPonto={ponto}
      fill
      realtimeOwnedExternally
    />
  );

  return (
    <>
      {isMobile ? (
        <div className="flex h-full min-h-0 flex-col">
          {selected ? detailPanel : listPanel}
        </div>
      ) : (
        <div className="flex h-full min-h-0">
          <aside className="w-full max-w-sm shrink-0 border-r border-neutral-200 bg-white">
            {listPanel}
          </aside>
          <main className="min-w-0 flex-1">{detailPanel}</main>
          <aside className="flex w-full max-w-sm shrink-0 flex-col border-l border-neutral-200 bg-white">
            {chatSidebar}
          </aside>
        </div>
      )}

      <GravacaoExternaEntregaModal
        open={entregaModalOpen}
        item={selected}
        saving={entregaMutation.isPending}
        onClose={() => setEntregaModalOpen(false)}
        onConfirm={(payload) => void handleEntrega(payload)}
      />

      <GravacaoRealtimeToast message={toast} onClear={clearToast} />
    </>
  );
}
