import { cn } from "@sagra/ui";
import { ArrowLeft, CheckCircle2, Loader2, PackageCheck, Search, Send } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  gravacaoExternaCompositePreviewUrl,
  gravacaoExternaDownloadUrl,
  gravacaoExternaPreviewUrl,
  type GravacaoExternaOsItem,
} from "@/api/gravacaoExterna";
import {
  useConcluirGravacaoExternaMutation,
  GRAVACAO_EXTERNA_SAFETY_POLL_MS,
  useGravacaoExternaAguardandoEntrega,
  useGravacaoExternaDetails,
  useGravacaoExternaOsList,
  useLancarEntregaChapasMutation,
  useRemoverOsAguardandoEntregaMutation,
  useRemoverOsGravacaoExternaMutation,
} from "@/api/hooks/useGravacaoExterna";
import { useAuthStore } from "@/features/auth/authStore";
import { useAccessControl } from "@/features/auth/useAccessControl";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useMatchMedia } from "@/hooks/useMatchMedia";
import {
  formatOsCardSubtitle,
  formatOsJuntadaLabel,
} from "../utils/formatOsJuntadaLabel";
import {
  gravacaoComponenteLabel,
  groupGravacaoItemsByOs,
  type GravacaoOsGroup,
} from "../utils/groupGravacaoItemsByOs";
import { GravacaoExternaStatusBadge } from "./GravacaoExternaActions";
import { GravacaoExternaChatModal } from "./GravacaoExternaChatModal";
import {
  GravacaoExternaEnvioSection,
  gravacaoFornecedorKey,
  gravacaoFornecedorLabel,
} from "./GravacaoExternaEnvioSection";
import { GravacaoExternaDownloadsPendentesModal } from "./GravacaoExternaDownloadsPendentesModal";
import { GravacaoExternaEntregaModal } from "./GravacaoExternaEntregaModal";
import { GravacaoQueueItemContextMenu } from "./GravacaoQueueItemContextMenu";
import { GravacaoExternaPreview, type PreviewSelection } from "./GravacaoExternaPreview";
import { useGravacaoExternaRealtime } from "../hooks/useGravacaoExternaRealtime";
import {
  enrichMaquinasDownloadPendentes,
  listMaquinasDownloadPendentes,
  type MaquinaDownloadPendente,
} from "../utils/plateFilenameUtils";
import { getApiErrorDetail } from "@/lib/api";

type ExternaListSegment = "em_andamento" | "aguardando_entrega";
type ExternaOsGroup = GravacaoOsGroup<GravacaoExternaOsItem>;

function formatOsListLabel(item: GravacaoExternaOsItem): string {
  return formatOsJuntadaLabel(item.membros, item);
}

function listItemHasSession(item: GravacaoExternaOsItem): boolean {
  return item.gravacao_status !== "sem_sessao" && item.gravacao_externa_id != null;
}

function externaSessionId(item: GravacaoExternaOsItem): number | null {
  return item.gravacao_externa_id ?? null;
}

const STATUS_RANK: Record<string, number> = {
  sem_sessao: 0,
  pendente: 1,
  iniciada: 2,
  concluida: 3,
};

/** Status do card: o envio menos avançado da OS. */
function groupStatus(group: ExternaOsGroup): string {
  let best = group.anchor.gravacao_status;
  for (const session of group.sessions) {
    if ((STATUS_RANK[session.gravacao_status] ?? 99) < (STATUS_RANK[best] ?? 99)) {
      best = session.gravacao_status;
    }
  }
  return best;
}

interface FornecedorBadge {
  key: string;
  label: string;
}

function groupFornecedores(group: ExternaOsGroup): FornecedorBadge[] {
  const byKey = new Map<string, FornecedorBadge>();
  for (const session of group.sessions) {
    const key = gravacaoFornecedorKey(session);
    if (!byKey.has(key)) {
      byKey.set(key, { key, label: gravacaoFornecedorLabel(session) });
    }
  }
  return [...byKey.values()].sort((a, b) => {
    if (!a.key !== !b.key) return a.key ? -1 : 1;
    return a.label.localeCompare(b.label, "pt-BR", { sensitivity: "base" });
  });
}

function envioLabel(item: GravacaoExternaOsItem): string {
  return [gravacaoFornecedorLabel(item), gravacaoComponenteLabel(item.componente)]
    .filter(Boolean)
    .join(" · ");
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
  const isFornecedor = Boolean(user?.fornecedor);
  const canOperate = can("sb_gravacao_externa_operador") || isFornecedor;
  const canConcluirSemSessao = can("sb_gravacao_externa_operador");
  const canDownload = canOperate;
  const canLancarRecebimento = can("sb_gravacao_externa_entrega");
  const canManagePendingQueue = can("sb_gravacao_pendente") && !user?.fornecedor;
  const showFornecedorBadges = !user?.fornecedor;
  const ponto = user?.ponto != null ? String(user.ponto) : null;
  const isMobile = useMatchMedia("(max-width: 767px)");

  const currentYear = new Date().getFullYear();
  const [ano, setAno] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 300);
  const [segment, setSegment] = useState<ExternaListSegment>("em_andamento");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [fornecedorFilter, setFornecedorFilter] = useState<string | null>(null);
  const [focusedSessionId, setFocusedSessionId] = useState<number | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [previewSelection, setPreviewSelection] = useState<PreviewSelection | null>(null);
  const [optimisticDownloadedIds, setOptimisticDownloadedIds] = useState(
    () => new Set<number>(),
  );
  const [entregaItem, setEntregaItem] = useState<GravacaoExternaOsItem | null>(null);
  const [downloadsPendentes, setDownloadsPendentes] = useState<
    MaquinaDownloadPendente[] | string[] | null
  >(null);

  useEffect(() => {
    setOptimisticDownloadedIds(new Set());
  }, [selectedKey]);

  const markArquivosDownloaded = useCallback((ids: Iterable<number>) => {
    setOptimisticDownloadedIds((prev) => {
      let changed = false;
      const next = new Set(prev);
      for (const id of ids) {
        if (!next.has(id)) {
          next.add(id);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, []);

  const markArquivoDownloaded = useCallback(
    (arquivoId: number) => {
      markArquivosDownloaded([arquivoId]);
    },
    [markArquivosDownloaded],
  );

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
  const listItems = listQuery.data?.items;
  const groups = useMemo(
    () => groupGravacaoItemsByOs(listItems ?? [], externaSessionId),
    [listItems],
  );
  const selectedGroup = useMemo(
    () => groups.find((g) => g.key === selectedKey) ?? null,
    [groups, selectedKey],
  );
  const selected = selectedGroup?.anchor ?? null;

  const visibleSessions = useMemo(() => {
    if (!selectedGroup) return [];
    if (fornecedorFilter == null) return selectedGroup.sessions;
    const filtered = selectedGroup.sessions.filter(
      (s) => gravacaoFornecedorKey(s) === fornecedorFilter,
    );
    return filtered.length > 0 ? filtered : selectedGroup.sessions;
  }, [selectedGroup, fornecedorFilter]);
  const sessionItems = useMemo(
    () => (selectedGroup ? selectedGroup.sessions.filter(listItemHasSession) : []),
    [selectedGroup],
  );
  const sessionIds = useMemo(
    () => sessionItems.map((s) => s.gravacao_externa_id as number),
    [sessionItems],
  );
  const visibleSessionItems = useMemo(
    () => visibleSessions.filter(listItemHasSession),
    [visibleSessions],
  );
  const selectedHasSession = visibleSessionItems.length > 0;
  const multiEnvio = visibleSessionItems.length > 1;

  const focusedSession =
    visibleSessionItems.find((s) => s.gravacao_externa_id === focusedSessionId) ??
    visibleSessionItems[0] ??
    null;
  const focusedId = focusedSession?.gravacao_externa_id ?? null;

  const detailQuery = useGravacaoExternaDetails(
    selected?.ano ?? null,
    selected?.nr_os ?? null,
    sessionIds,
    sessionIds.length > 0 && !isAguardando,
    { refetchInterval: GRAVACAO_EXTERNA_SAFETY_POLL_MS },
  );

  const downloadedArquivoIds = useMemo(() => {
    const next = new Set<number>(optimisticDownloadedIds);
    for (const detail of detailQuery.data) {
      if (!detail?.arquivos) continue;
      for (const arquivo of detail.arquivos) {
        if (arquivo.baixado_em) next.add(arquivo.id);
      }
    }
    return next;
  }, [detailQuery.data, optimisticDownloadedIds]);

  const detailFor = (id: number | null | undefined) => {
    const idx = id == null ? -1 : sessionIds.indexOf(id);
    return {
      detail: idx >= 0 ? detailQuery.data[idx] : undefined,
      failed: idx >= 0 ? Boolean(detailQuery.failed[idx]) : false,
    };
  };
  const concluirMutation = useConcluirGravacaoExternaMutation();
  const entregaMutation = useLancarEntregaChapasMutation();
  const removerPendenteMutation = useRemoverOsGravacaoExternaMutation();
  const removerAguardandoMutation = useRemoverOsAguardandoEntregaMutation();
  const removerMutation = isAguardando ? removerAguardandoMutation : removerPendenteMutation;

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

  const years = useMemo(() => {
    const ys: number[] = [];
    for (let y = currentYear; y >= currentYear - 5; y -= 1) {
      ys.push(y);
    }
    return ys;
  }, [currentYear]);

  const clearSelection = () => {
    setSelectedKey(null);
    setFornecedorFilter(null);
    setFocusedSessionId(null);
    setPreviewSelection(null);
    setEntregaItem(null);
    setChatOpen(false);
  };

  const handleSelectOs = (group: ExternaOsGroup, fornecedorKey: string | null = null) => {
    setSelectedKey(group.key);
    setFornecedorFilter(fornecedorKey);
    setFocusedSessionId(null);
    setPreviewSelection(null);
    setEntregaItem(null);
  };

  const handleFornecedorBadge = (group: ExternaOsGroup, fornecedorKey: string) => {
    if (selectedKey === group.key && fornecedorFilter === fornecedorKey) {
      setFornecedorFilter(null);
      return;
    }
    handleSelectOs(group, fornecedorKey);
  };

  const handleSegmentChange = (next: ExternaListSegment) => {
    setSegment(next);
    clearSelection();
  };

  const handleRemoveFromQueue = async (group: ExternaOsGroup) => {
    const item = group.anchor;
    const ids = group.sessions
      .map((s) => s.gravacao_externa_id)
      .filter((id): id is number => id != null);
    if (ids.length === 0) return;
    const isJuntada = (item.membros?.length ?? 0) > 1;
    const envios = ids.length > 1 ? ` (${ids.length} envios)` : "";
    const alvo = isJuntada ? "a juntada" : "a OS";
    const lista = isAguardando
      ? "da lista Aguardando retirada"
      : "da lista de OPs pendentes no Birô";
    const detalhes = isAguardando
      ? "Nenhum andamento será lançado. Arquivos e histórico serão preservados."
      : "Arquivos, histórico e andamentos serão preservados.";
    const confirmed = window.confirm(
      `Remover ${alvo} ${formatOsListLabel(item)}${envios} ${lista}?\n\n` +
        (isJuntada ? "Todas as OSs desta juntada serão removidas. " : "") +
        detalhes,
    );
    if (!confirmed) return;
    const errors: string[] = [];
    const removed = new Set<number>();
    for (const id of ids) {
      if (removed.has(id)) continue;
      try {
        const result = await removerMutation.mutateAsync(id);
        removed.add(id);
        for (const removedId of result?.removed_ids ?? []) removed.add(removedId);
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
    }
    if (selectedKey === group.key && errors.length < ids.length) {
      clearSelection();
    }
    if (errors.length > 0) {
      window.alert(
        errors.length === ids.length
          ? errors[0] || "Não foi possível remover a OS da lista."
          : `Parte da OS não pôde ser removida: ${errors.join(" · ")}`,
      );
    }
  };

  const handleConcluir = async (session: GravacaoExternaOsItem) => {
    const sessionId = session.gravacao_externa_id;
    const detail = sessionId != null ? detailFor(sessionId).detail : undefined;
    const chapasPorMaquina =
      session.chapas_por_maquina?.length
        ? session.chapas_por_maquina
        : detail?.chapas_por_maquina ?? null;
    if (sessionId != null) {
      const pendentes = listMaquinasDownloadPendentes(
        detail?.arquivos ?? [],
        downloadedArquivoIds,
        chapasPorMaquina,
      );
      if (pendentes.length > 0) {
        setDownloadsPendentes(pendentes);
        return;
      }
    }

    const outros = multiEnvio ? ` (${envioLabel(session)})` : "";
    if (!window.confirm(`Confirmar conclusão da Gravação Externa desta OS${outros}?`)) {
      return;
    }
    try {
      await concluirMutation.mutateAsync({
        ano: session.ano,
        nrOs: session.nr_os,
        gravacaoExternaId: session.gravacao_externa_id,
      });
      if ((selectedGroup?.sessions.length ?? 0) <= 1) {
        clearSelection();
      } else if (previewSelection?.sessionId === session.gravacao_externa_id) {
        setPreviewSelection(null);
      }
      window.alert("Gravação Externa concluída.");
    } catch (e) {
      const apiDetail = getApiErrorDetail(e);
      if (
        apiDetail?.code === "downloads_pendentes" &&
        Array.isArray(apiDetail.maquinas) &&
        apiDetail.maquinas.length > 0
      ) {
        setDownloadsPendentes(
          enrichMaquinasDownloadPendentes(apiDetail.maquinas, chapasPorMaquina),
        );
        return;
      }
      if (sessionId != null) {
        const fallback = listMaquinasDownloadPendentes(
          detailFor(sessionId).detail?.arquivos ?? [],
          downloadedArquivoIds,
          chapasPorMaquina,
        );
        if (fallback.length > 0) {
          setDownloadsPendentes(fallback);
          return;
        }
      }
      window.alert(
        e instanceof Error ? e.message : "Não foi possível concluir a gravação.",
      );
    }
  };

  const handleEntrega = async (payload: {
    recebidoPorPonto: string;
    recebidoPorNome: string;
  }) => {
    if (!entregaItem) return;
    try {
      await entregaMutation.mutateAsync({
        ano: entregaItem.ano,
        nrOs: entregaItem.nr_os,
        recebidoPorPonto: payload.recebidoPorPonto,
        recebidoPorNome: payload.recebidoPorNome,
        gravacaoExternaId: entregaItem.gravacao_externa_id,
      });
      window.alert("Recebimento das chapas lançado.");
      setEntregaItem(null);
      if ((selectedGroup?.sessions.length ?? 0) <= 1) {
        clearSelection();
      }
    } catch (e) {
      window.alert(
        e instanceof Error ? e.message : "Não foi possível lançar o recebimento.",
      );
    }
  };

  const handleDownloaded = () => {
    void detailQuery.refetch();
    void andamentoQuery.refetch();
  };

  const previewSessionId = previewSelection?.sessionId ?? focusedId;
  const previewSession =
    visibleSessionItems.find((session) => session.gravacao_externa_id === previewSessionId) ??
    focusedSession;
  const previewDetail = detailFor(previewSession?.gravacao_externa_id).detail;
  const getExternaPreviewUrl = useCallback(
    (a: number, n: number, arquivoId: number) =>
      gravacaoExternaPreviewUrl(a, n, arquivoId, previewSessionId),
    [previewSessionId],
  );
  const getExternaCompositeUrl = useCallback(
    (a: number, n: number, groupKey: string) =>
      gravacaoExternaCompositePreviewUrl(a, n, groupKey, previewSessionId),
    [previewSessionId],
  );
  const getExternaDownloadUrl = useCallback(
    (a: number, n: number, arquivoId: number) =>
      gravacaoExternaDownloadUrl(a, n, arquivoId, previewSessionId),
    [previewSessionId],
  );

  const renderListItem = (group: ExternaOsGroup) => {
    const item = group.anchor;
    const active = selectedKey === group.key;
    const fornecedores = showFornecedorBadges ? groupFornecedores(group) : [];
    const status = isAguardando ? "concluida" : groupStatus(group);
    const isIniciada = !isAguardando && status === "iniciada";
    const concluivelSession =
      group.sessions.find((s) => s.gravacao_status === "iniciada") ?? item;
    const showCardConcluir = isIniciada && isFornecedor && listItemHasSession(concluivelSession);
    return (
      <li key={group.key}>
        <GravacaoQueueItemContextMenu
          enabled={
            canManagePendingQueue &&
            group.sessions.some((s) => s.gravacao_externa_id != null)
          }
          label={`OS ${formatOsListLabel(item)}`}
          removing={removerMutation.isPending}
          onRemove={() => handleRemoveFromQueue(group)}
        >
          <div
            className={cn(
              "overflow-hidden rounded-lg border transition-colors",
              active
                ? "border-primary-green bg-primary-green/10"
                : "border-neutral-200 bg-white hover:border-neutral-300",
            )}
          >
            <div
              className={cn(
                "flex items-start gap-2 px-3 pt-2.5",
                fornecedores.length > 0 ? "pb-1" : "pb-2.5",
              )}
            >
              <button
                type="button"
                onClick={() => handleSelectOs(group)}
                className="min-w-0 flex-1 text-left"
              >
                <span className="block text-xs-button font-semibold text-neutral-900">
                  {formatOsListLabel(item)}
                </span>
                <p className="mt-0.5 truncate text-xs text-neutral-600">
                  {formatOsCardSubtitle(item)}
                </p>
              </button>
              <div className="inline-grid shrink-0 grid-cols-1 justify-items-stretch gap-1">
                <GravacaoExternaStatusBadge
                  status={status}
                  className="justify-center"
                />
                {showCardConcluir ? (
                  <button
                    type="button"
                    disabled={
                      concluirMutation.isPending &&
                      concluirMutation.variables?.gravacaoExternaId ===
                        concluivelSession.gravacao_externa_id
                    }
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      void handleConcluir(concluivelSession);
                    }}
                    className="inline-flex cursor-pointer items-center justify-center gap-1 rounded-full border border-primary-green bg-primary-green px-2.5 py-0.5 text-xs font-semibold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {concluirMutation.isPending &&
                    concluirMutation.variables?.gravacaoExternaId ===
                      concluivelSession.gravacao_externa_id ? (
                      <Loader2 className="size-3 animate-spin" aria-hidden />
                    ) : (
                      <CheckCircle2 className="size-3" aria-hidden />
                    )}
                    Concluir
                  </button>
                ) : null}
              </div>
            </div>
            {fornecedores.length > 0 ? (
              <div className="flex flex-wrap gap-1 px-3 pb-2.5">
                {fornecedores.map((f) => {
                  const pressed = active && fornecedorFilter === f.key;
                  return (
                    <button
                      key={f.key || "sem-fornecedor"}
                      type="button"
                      title="Exibir espelhos de chapa"
                      aria-pressed={pressed}
                      onClick={() => handleFornecedorBadge(group, f.key)}
                      className={cn(
                        "inline-flex max-w-full cursor-pointer truncate rounded-full border px-2 py-0.5 text-[11px] font-semibold transition-colors",
                        pressed
                          ? "border-blue-600 bg-blue-600 text-white"
                          : "border-blue-100 bg-blue-50 text-blue-700 hover:border-blue-300",
                      )}
                    >
                      {f.label}
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>
        </GravacaoQueueItemContextMenu>
      </li>
    );
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
          <ul className="space-y-1">{groups.map(renderListItem)}</ul>
        )}
      </div>
    </div>
  );

  const mobileBackButton = isMobile ? (
    <button
      type="button"
      onClick={clearSelection}
      className="inline-flex items-center gap-1 rounded border border-neutral-300 px-2 py-1 text-xs"
    >
      <ArrowLeft className="size-3.5" />
      Voltar
    </button>
  ) : null;

  const aguardandoDetailPanel = !selected ? (
    <div className="flex h-full items-center justify-center p-8 text-center text-sm text-neutral-500">
      Selecione uma OS concluída para lançar o recebimento das chapas.
    </div>
  ) : (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto p-3 md:p-4">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          {mobileBackButton}
          <h2 className="text-xs-button font-semibold text-neutral-900">
            OS {formatOsListLabel(selected)}
          </h2>
          <GravacaoExternaStatusBadge status="concluida" />
        </div>
        <p className="mt-1 text-sm text-neutral-600">
          {selected.solicitante}
          {selected.produto ? ` · ${selected.produto}` : ""}
        </p>
      </div>

      {visibleSessions.map((session) => {
        const fornecedor = gravacaoFornecedorLabel(session);
        const componente = gravacaoComponenteLabel(session.componente);
        const receiving =
          entregaMutation.isPending && entregaItem?.gravacao_externa_id === session.gravacao_externa_id;
        return (
          <section
            key={session.gravacao_externa_id ?? `${session.ano}-${session.nr_os}`}
            aria-label={`Envio ${envioLabel(session)}`}
            className="space-y-2 rounded-lg border border-neutral-200 p-3"
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                {session.fornecedor_nome?.trim() || session.fornecedor_ponto ? (
                  <p className="text-sm font-semibold text-neutral-800">
                    Fornecedor: {fornecedor}
                    {componente ? (
                      <span className="ml-2 text-xs font-medium text-blue-700">{componente}</span>
                    ) : null}
                  </p>
                ) : componente ? (
                  <p className="text-xs font-medium text-blue-700">{componente}</p>
                ) : null}
              </div>
              {canLancarRecebimento && (
                <button
                  type="button"
                  onClick={() => setEntregaItem(session)}
                  disabled={entregaMutation.isPending}
                  className="inline-flex items-center gap-2 rounded bg-primary-green px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
                >
                  {receiving ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <PackageCheck className="size-4" />
                  )}
                  Lançar recebimento das chapas
                </button>
              )}
            </div>

            {(session.chapas_por_maquina?.length ?? 0) > 0 ? (
              <div className="rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
                  Chapas
                </h3>
                <ul className="mt-1 flex flex-wrap gap-2 text-sm text-neutral-800">
                  {session.chapas_por_maquina?.map((c) => (
                    <li
                      key={c.maquina}
                      className="rounded-full border border-neutral-300 bg-white px-2.5 py-0.5"
                    >
                      {c.maquina}: <strong>{c.quantidade}</strong>
                    </li>
                  ))}
                </ul>
                {session.total_chapas != null ? (
                  <p className="mt-1 text-xs text-neutral-500">Total: {session.total_chapas}</p>
                ) : null}
              </div>
            ) : null}
          </section>
        );
      })}
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
          onClick={() => void handleConcluir(selected)}
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
  ) : detailQuery.isLoading && detailQuery.data.every((d) => d == null) ? (
    <div className="flex h-full items-center justify-center">
      <Loader2 className="size-8 animate-spin text-primary-green" />
    </div>
  ) : detailQuery.isError && detailQuery.data.every((d) => d == null) ? (
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
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {mobileBackButton}
            <h2 className="text-xs-button font-semibold text-neutral-900">
              OS {formatOsListLabel(selected)}
            </h2>
          </div>
          <p className="mt-1 text-sm text-neutral-600">
            {selected.solicitante}
            {selected.produto ? ` · ${selected.produto}` : ""}
          </p>
        </div>
        {isFornecedor &&
        previewSession &&
        previewDetail &&
        (previewDetail.status === "pendente" || previewDetail.status === "iniciada") ? (
          <button
            type="button"
            disabled={
              concluirMutation.isPending &&
              concluirMutation.variables?.gravacaoExternaId ===
                previewSession.gravacao_externa_id
            }
            onClick={() => void handleConcluir(previewSession)}
            className="inline-flex shrink-0 items-center gap-2 rounded border border-primary-green bg-white px-4 py-2 text-sm font-medium text-primary-green hover:bg-primary-green/5 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {concluirMutation.isPending &&
            concluirMutation.variables?.gravacaoExternaId ===
              previewSession.gravacao_externa_id ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <CheckCircle2 className="size-4" />
            )}
            Gravação concluída
          </button>
        ) : null}
      </div>

      <div className="grid min-h-0 min-w-0 flex-1 grid-cols-1 gap-3 overflow-hidden lg:grid-cols-[minmax(240px,32%)_minmax(0,1fr)]">
        <div className="min-h-[200px] min-w-0 space-y-3 overflow-y-auto lg:min-h-0">
          {visibleSessionItems.map((session) => {
            const id = session.gravacao_externa_id as number;
            const state = detailFor(id);
            return (
              <GravacaoExternaEnvioSection
                key={id}
                item={session}
                detail={state.detail}
                failed={state.failed}
                showOrigem={multiEnvio}
                focused={focusedId === id}
                onFocus={() => setFocusedSessionId(id)}
                canDownload={canDownload}
                previewSelection={previewSelection}
                onSelectPreview={(selection) => {
                  setFocusedSessionId(id);
                  setPreviewSelection(selection);
                }}
                onDownloaded={handleDownloaded}
                downloadedArquivoIds={downloadedArquivoIds}
                onArquivoDownloaded={markArquivoDownloaded}
                onArquivosDownloaded={markArquivosDownloaded}
              />
            );
          })}
        </div>
        <div className="flex min-h-[280px] min-w-0 flex-col overflow-hidden lg:min-h-0 lg:h-full">
          <div className="min-h-0 flex-1">
            <GravacaoExternaPreview
              ano={selected.ano}
              nrOs={selected.nr_os}
              selection={previewSelection}
              canDownload={canDownload}
              getPreviewUrl={getExternaPreviewUrl}
              getCompositePreviewUrl={getExternaCompositeUrl}
              getDownloadUrl={getExternaDownloadUrl}
              onArquivoDownloaded={markArquivoDownloaded}
            />
          </div>
        </div>
      </div>
    </div>
  );

  const showChatFab =
    !isAguardando && selected != null && selectedHasSession && focusedId != null;

  return (
    <>
      {isMobile ? (
        <div className="flex h-full min-h-0 flex-col">
          {selected ? detailPanel : listPanel}
        </div>
      ) : (
        <div className="flex h-full min-h-0">
          <aside className="w-full max-w-[20.25rem] shrink-0 border-r border-neutral-200 bg-white">
            {listPanel}
          </aside>
          <main className="min-w-0 flex-1">{detailPanel}</main>
        </div>
      )}

      {showChatFab ? (
        <button
          type="button"
          onClick={() => setChatOpen(true)}
          className={cn(
            "fixed bottom-[calc(5.5rem+env(safe-area-inset-bottom,0px))] right-4 z-50",
            "flex size-14 items-center justify-center rounded-full bg-primary-green text-white shadow-lg",
            "hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-green",
            "md:bottom-6",
          )}
          aria-label="Abrir mensagens"
          title="Mensagens"
        >
          <Send className="size-6" aria-hidden />
        </button>
      ) : null}

      {selected && showChatFab ? (
        <GravacaoExternaChatModal
          open={chatOpen}
          ano={selected.ano}
          nrOs={selected.nr_os}
          gravacaoExternaId={focusedId}
          currentPonto={ponto}
          onClose={() => setChatOpen(false)}
        />
      ) : null}

      <GravacaoExternaEntregaModal
        open={entregaItem != null}
        item={entregaItem}
        saving={entregaMutation.isPending}
        onClose={() => setEntregaItem(null)}
        onConfirm={(payload) => void handleEntrega(payload)}
      />

      <GravacaoExternaDownloadsPendentesModal
        open={downloadsPendentes != null}
        maquinas={downloadsPendentes ?? []}
        onClose={() => setDownloadsPendentes(null)}
      />

      <GravacaoRealtimeToast message={toast} onClear={clearToast} />
    </>
  );
}
