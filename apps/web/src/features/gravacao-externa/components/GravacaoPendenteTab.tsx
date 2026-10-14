import { cn } from "@sagra/ui";
import {
  ArrowLeft,
  ChevronsLeft,
  ChevronsRight,
  Clock,
  Loader2,
  Pencil,
  Plus,
  Search,
  Send,
  Trash2,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import type {
  GravacaoPendenteControleUpdateBody,
  GravacaoPendenteDetail,
  GravacaoPendenteEnvioParcial,
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
  useAdicionarOsGravacaoPendenteMutation,
  useEnviarGravacaoPendenteMutation,
  useDeleteGravacaoPendenteControleMutation,
  useGravacaoPendenteDetails,
  useGravacaoPendenteHistorico,
  useGravacaoPendenteOsList,
  usePatchGravacaoPendenteControleMutation,
  usePatchGravacaoPendenteObservacaoMutation,
  useRemoverOsGravacaoPendenteMutation,
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
import {
  gravacaoComponenteLabel,
  groupGravacaoItemsByOs,
  type GravacaoOsGroup,
} from "../utils/groupGravacaoItemsByOs";
import { GravacaoFornecedorSelectModal } from "./GravacaoFornecedorSelectModal";
import { GravacaoPendenteAdicionarOsModal } from "./GravacaoPendenteAdicionarOsModal";
import { GravacaoObservacaoBox } from "./GravacaoObservacaoBox";
import { GravacaoPendenteControleEditModal } from "./GravacaoPendenteControleEditModal";
import { GravacaoPendenteHistoricoCota } from "./GravacaoPendenteHistoricoCota";
import { GravacaoQueueItemContextMenu } from "./GravacaoQueueItemContextMenu";
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

function pendenteSessionId(item: GravacaoPendenteOsItem): number | null {
  return item.gravacao_pendente_id ?? null;
}

function machineKey(maquina: string | null | undefined): string {
  return String(maquina ?? "").trim().toLowerCase();
}

function envioFornecedorLabel(envio: GravacaoPendenteEnvioParcial): string {
  return envio.fornecedor_nome?.trim() || envio.fornecedor_ponto?.trim() || "fornecedor";
}

interface MachineChapaChip {
  key: string;
  maquina: string;
  quantidade: number;
}

interface SentMachineChip extends MachineChapaChip {
  fornecedor: string;
}

/** Chapas ainda pendentes de envio, somadas por máquina entre capa/miolo. */
function aggregatePendingChapas(details: GravacaoPendenteDetail[]): MachineChapaChip[] {
  const byKey = new Map<string, MachineChapaChip>();
  for (const detail of details) {
    for (const chapa of detail.chapas) {
      const key = machineKey(chapa.maquina);
      if (!key) continue;
      const current = byKey.get(key);
      if (current) {
        current.quantidade += chapa.quantidade;
      } else {
        byKey.set(key, { key, maquina: chapa.maquina.trim(), quantidade: chapa.quantidade });
      }
    }
    for (const arquivo of detail.arquivos) {
      const key = machineKey(arquivo.maquina);
      if (key && !byKey.has(key)) {
        byKey.set(key, { key, maquina: String(arquivo.maquina).trim(), quantidade: 0 });
      }
    }
  }
  return [...byKey.values()];
}

/** Máquinas já enviadas ao Birô (partes desmembradas), por máquina e fornecedor. */
function aggregateSentChapas(details: GravacaoPendenteDetail[]): SentMachineChip[] {
  const byKey = new Map<string, SentMachineChip>();
  for (const detail of details) {
    for (const envio of detail.envios ?? []) {
      const fornecedor = envioFornecedorLabel(envio);
      for (const chapa of envio.chapas) {
        const key = `${machineKey(chapa.maquina)}|${fornecedor}`;
        const current = byKey.get(key);
        if (current) {
          current.quantidade += chapa.quantidade;
        } else {
          byKey.set(key, {
            key,
            maquina: chapa.maquina.trim(),
            quantidade: chapa.quantidade,
            fornecedor,
          });
        }
      }
    }
  }
  return [...byKey.values()];
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
  const canManageQueue = can("sb_gravacao_pendente") && !user?.fornecedor;
  const isMobile = useMatchMedia("(max-width: 767px)");

  const currentYear = new Date().getFullYear();
  const [ano, setAno] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 300);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [selectedMaquinaKeys, setSelectedMaquinaKeys] = useState<string[]>([]);
  const [previewSelection, setPreviewSelection] = useState<PreviewSelection | null>(null);
  const [fornecedorModalOpen, setFornecedorModalOpen] = useState(false);
  const [adicionarModalOpen, setAdicionarModalOpen] = useState(false);
  const [fornecedores, setFornecedores] = useState<GravacaoPendenteFornecedorItem[]>([]);
  const [controleExpanded, setControleExpanded] = useState(false);
  const [editingControleItem, setEditingControleItem] =
    useState<GravacaoPendenteHistoricoItem | null>(null);
  const patchControleMutation = usePatchGravacaoPendenteControleMutation();
  const patchObservacaoMutation = usePatchGravacaoPendenteObservacaoMutation();
  const deleteControleMutation = useDeleteGravacaoPendenteControleMutation();
  const removerMutation = useRemoverOsGravacaoPendenteMutation();

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

  const groups = useMemo(
    () => groupGravacaoItemsByOs(listQuery.data?.items ?? [], pendenteSessionId),
    [listQuery.data?.items],
  );
  const selectedGroup: GravacaoOsGroup<GravacaoPendenteOsItem> | null = useMemo(
    () => groups.find((g) => g.key === selectedKey) ?? null,
    [groups, selectedKey],
  );
  const selected = selectedGroup?.anchor ?? null;
  const sessionItems = useMemo(
    () => (selectedGroup ? selectedGroup.sessions.filter(listItemHasSession) : []),
    [selectedGroup],
  );
  const sessionIds = useMemo(
    () => sessionItems.map((s) => s.gravacao_pendente_id as number),
    [sessionItems],
  );
  const selectedHasSession = sessionIds.length > 0;

  const detailQuery = useGravacaoPendenteDetails(
    selected?.ano ?? null,
    selected?.nr_os ?? null,
    sessionIds,
    selectedHasSession,
  );

  const enviarMutation = useEnviarGravacaoPendenteMutation();
  const adicionarMutation = useAdicionarOsGravacaoPendenteMutation();

  const details = useMemo(
    () => detailQuery.data.filter((d): d is GravacaoPendenteDetail => d != null),
    [detailQuery.data],
  );
  const detailsReady = selectedHasSession && details.length === sessionIds.length;
  const firstDetail = details[0] ?? null;
  const multiSession = details.length > 1;
  const totalArquivos = details.reduce((sum, d) => sum + d.arquivos.length, 0);
  const pendingChips = useMemo(() => aggregatePendingChapas(details), [details]);
  const sentChips = useMemo(() => aggregateSentChapas(details), [details]);
  const canEnviar = canLancarExterna && details.some((d) => d.status === "ativa");
  const selectedChips = pendingChips.filter((chip) => selectedMaquinaKeys.includes(chip.key));
  const isPartialSelection =
    selectedChips.length > 0 &&
    details.some((d) =>
      d.arquivos.some((arq) => !selectedMaquinaKeys.includes(machineKey(arq.maquina))),
    );

  const clearSelection = () => {
    setSelectedKey(null);
    setSelectedMaquinaKeys([]);
    setPreviewSelection(null);
  };

  const toggleMaquina = (key: string) => {
    setSelectedMaquinaKeys((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
    );
  };

  const getPendentePreviewUrl = useCallback(
    (a: number, n: number, arquivoId: number) =>
      gravacaoPendentePreviewUrl(a, n, arquivoId, previewSelection?.sessionId ?? sessionIds[0]),
    [previewSelection?.sessionId, sessionIds],
  );
  const getPendenteCompositeUrl = useCallback(
    (a: number, n: number, groupKey: string) =>
      gravacaoPendenteCompositePreviewUrl(
        a,
        n,
        groupKey,
        previewSelection?.sessionId ?? sessionIds[0],
      ),
    [previewSelection?.sessionId, sessionIds],
  );
  const getPendenteDownloadUrl = useCallback(
    (a: number, n: number, arquivoId: number) =>
      gravacaoPendenteDownloadUrl(a, n, arquivoId, previewSelection?.sessionId ?? sessionIds[0]),
    [previewSelection?.sessionId, sessionIds],
  );

  const years = useMemo(() => {
    const ys: number[] = [];
    for (let y = currentYear; y >= currentYear - 5; y -= 1) {
      ys.push(y);
    }
    return ys;
  }, [currentYear]);

  const handleSelectOs = (group: GravacaoOsGroup<GravacaoPendenteOsItem>) => {
    setSelectedKey(group.key);
    setSelectedMaquinaKeys([]);
    setPreviewSelection(null);
  };

  const handleRemoveFromQueue = async (group: GravacaoOsGroup<GravacaoPendenteOsItem>) => {
    const item = group.anchor;
    const ids = group.sessions
      .map((s) => s.gravacao_pendente_id)
      .filter((id): id is number => id != null);
    if (ids.length === 0) return;
    const isJuntada = (item.membros?.length ?? 0) > 1;
    const partes =
      group.sessions.length > 1
        ? ` (${group.sessions
            .map((s) => gravacaoComponenteLabel(s.componente) ?? "Todos")
            .join(" e ")})`
        : "";
    const confirmed = window.confirm(
      isJuntada
        ? `Remover a juntada ${formatOsListLabel(item)}${partes} da lista de OPs para Gravação Externa?\n\nTodas as OSs desta juntada serão removidas. Arquivos, histórico e andamentos serão preservados.`
        : `Remover a OS ${formatOsListLabel(item)}${partes} da lista de OPs para Gravação Externa?\n\nArquivos, histórico e andamentos serão preservados.`,
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

  const doEnviar = async (fornecedorPonto?: string) => {
    if (!selected || sessionIds.length === 0) return;
    const maquinas = selectedChips.map((chip) => chip.maquina);
    const partial = isPartialSelection;
    try {
      await enviarMutation.mutateAsync({
        ano: selected.ano,
        nrOs: selected.nr_os,
        fornecedorPonto,
        gravacaoPendenteId: sessionIds[0],
        gravacaoPendenteIds: sessionIds,
        maquinas: partial ? maquinas : undefined,
      });
      setFornecedorModalOpen(false);
      setFornecedores([]);
      if (partial) {
        window.alert(`Arquivos de ${maquinas.join(", ")} enviados para Gravação Externa.`);
        setSelectedMaquinaKeys([]);
        setPreviewSelection(null);
      } else {
        window.alert("OS enviada para Gravação Externa.");
        clearSelection();
      }
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
    const confirmMessage = isPartialSelection
      ? `Enviar somente os arquivos de ${selectedChips
          .map((chip) => chip.maquina)
          .join(", ")} da OS ${formatOsListLabel(selected)} para Gravação Externa?\n\nOs demais arquivos continuam nesta lista.`
      : `Enviar OS ${formatOsListLabel(selected)} para Gravação Externa?`;
    if (!window.confirm(confirmMessage)) {
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
        await doEnviar(items[0]!.ponto);
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
            Nenhuma OS disponível para envio à Gravação Externa.
          </p>
        ) : (
          <ul className="space-y-1">
            {groups.map((group) => {
              const item = group.anchor;
              const active = selectedKey === group.key;
              return (
                <li key={group.key}>
                  <GravacaoQueueItemContextMenu
                    enabled={
                      canManageQueue &&
                      group.sessions.some((s) => s.gravacao_pendente_id != null)
                    }
                    label={`OS ${formatOsListLabel(item)}`}
                    removing={removerMutation.isPending}
                    onRemove={() => handleRemoveFromQueue(group)}
                  >
                    <button
                      type="button"
                      onClick={() => handleSelectOs(group)}
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
                  </GravacaoQueueItemContextMenu>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {canManageQueue ? (
        <div className="shrink-0 border-t border-neutral-200 bg-white p-3">
          <button
            type="button"
            onClick={() => setAdicionarModalOpen(true)}
            className="inline-flex w-full items-center justify-center gap-2 rounded bg-primary-green px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Plus className="size-4" />
            Adicionar OS
          </button>
        </div>
      ) : null}
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
  ) : detailQuery.isLoading && !detailsReady ? (
    <div className="flex h-full items-center justify-center">
      <Loader2 className="size-8 animate-spin text-primary-green" />
    </div>
  ) : detailQuery.isError || !detailsReady || !firstDetail ? (
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
                onClick={clearSelection}
                className="inline-flex items-center gap-1 rounded border border-neutral-300 px-2 py-1 text-xs"
              >
                <ArrowLeft className="size-3.5" />
                Voltar
              </button>
            )}
            <h2 className="text-lg font-semibold text-neutral-900">
              OS {formatOsListLabel(selected)}
            </h2>
            <PendenteStatusBadge status={firstDetail.status} />
          </div>
          <p className="mt-1 text-sm text-neutral-600">
            {selected.solicitante}
            {selected.produto ? ` · ${selected.produto}` : ""}
          </p>
          <p className="text-xs text-neutral-500">
            Lançado por {firstDetail.lancado_por_nome || firstDetail.lancado_por_ponto}
          </p>
        </div>
        {canEnviar ? (
          <div className="flex flex-col items-end gap-1">
            <button
              type="button"
              disabled={enviarMutation.isPending}
              onClick={() => void handleEnviar()}
              className="inline-flex items-center justify-center gap-2 rounded bg-primary-green px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {enviarMutation.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Send className="size-4" />
              )}
              Enviar para gravação externa
            </button>
            {isPartialSelection ? (
              <p className="text-xs text-neutral-600">
                Somente: {selectedChips.map((chip) => chip.maquina).join(", ")}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>

      {pendingChips.length > 0 || sentChips.length > 0 ? (
        <div className="rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
            Chapas
            {canEnviar && pendingChips.length > 1 ? (
              <span className="ml-2 font-normal normal-case tracking-normal text-neutral-500">
                Selecione máquinas para enviar só os arquivos delas
              </span>
            ) : null}
          </h3>
          <ul className="mt-1 flex flex-wrap gap-2 text-sm text-neutral-800">
            {pendingChips.map((chip) => {
              const pressed = selectedMaquinaKeys.includes(chip.key);
              return (
                <li key={`p-${chip.key}`}>
                  {canEnviar ? (
                    <button
                      type="button"
                      aria-pressed={pressed}
                      onClick={() => toggleMaquina(chip.key)}
                      title={
                        pressed
                          ? "Remover da seleção de envio"
                          : "Enviar somente os arquivos desta máquina"
                      }
                      className={cn(
                        "cursor-pointer rounded-full border px-2.5 py-0.5 transition-colors",
                        pressed
                          ? "border-primary-green bg-primary-green text-white"
                          : "border-neutral-300 bg-white hover:border-primary-green",
                      )}
                    >
                      {chip.maquina}: <strong>{chip.quantidade}</strong>
                    </button>
                  ) : (
                    <span className="inline-flex rounded-full border border-neutral-300 bg-white px-2.5 py-0.5">
                      {chip.maquina}: <strong className="ml-1">{chip.quantidade}</strong>
                    </span>
                  )}
                </li>
              );
            })}
            {sentChips.map((chip) => (
              <li
                key={`s-${chip.key}`}
                className="inline-flex rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-amber-800"
                title={`Enviado para o Birô ${chip.fornecedor}`}
              >
                {chip.maquina}: <strong className="mx-1">{chip.quantidade}</strong>· Enviado p/{" "}
                {chip.fornecedor}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="grid min-h-0 min-w-0 flex-1 grid-cols-1 gap-3 overflow-hidden lg:grid-cols-[minmax(200px,28%)_minmax(0,1fr)]">
        <div className="flex min-h-[200px] min-w-0 flex-col gap-2 overflow-hidden lg:min-h-0">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
            Arquivos ({totalArquivos})
          </h3>
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto">
            {details.map((sessionDetail) => {
              const componente = gravacaoComponenteLabel(sessionDetail.componente);
              return (
                <section key={sessionDetail.id} className="space-y-2">
                  {multiSession && componente ? (
                    <h4 className="text-xs font-semibold text-blue-700">{componente}</h4>
                  ) : null}
                  <GravacaoObservacaoBox
                    observacao={sessionDetail.observacao}
                    editable={canEditObservacao}
                    saving={patchObservacaoMutation.isPending}
                    onSave={async (text) => {
                      try {
                        await patchObservacaoMutation.mutateAsync({
                          ano: selected.ano,
                          nrOs: selected.nr_os,
                          observacao: text,
                          gravacaoPendenteId: sessionDetail.id,
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
                  <GravacaoExternaArquivosPanel
                    ano={selected.ano}
                    nrOs={selected.nr_os}
                    arquivos={sessionDetail.arquivos}
                    selection={
                      previewSelection?.sessionId === sessionDetail.id ? previewSelection : null
                    }
                    groupByMachine
                    chapasPorMaquina={sessionDetail.chapas}
                    onSelect={(arq) =>
                      setPreviewSelection({
                        kind: "file",
                        arquivo: arq,
                        sessionId: sessionDetail.id,
                      })
                    }
                    onSelectComposite={(chapa) =>
                      setPreviewSelection({
                        kind: "composite",
                        groupKey: chapa.groupKey,
                        chapaLabel: chapa.chapaLabel,
                        displayLabel: chapa.displayLabel,
                        sessionId: sessionDetail.id,
                      })
                    }
                    getDownloadUrl={(a, n, arquivoId) =>
                      gravacaoPendenteDownloadUrl(a, n, arquivoId, sessionDetail.id)
                    }
                  />
                  {(sessionDetail.envios ?? []).map((envio) => (
                    <div
                      key={envio.gravacao_pendente_id}
                      className="space-y-1 rounded-lg border border-amber-200 bg-amber-50/60 p-2"
                    >
                      <p className="text-xs font-semibold text-amber-800">
                        Enviado p/ Birô {envioFornecedorLabel(envio)}
                        {envio.maquinas.length > 0 ? ` · ${envio.maquinas.join(", ")}` : ""}
                        {envio.enviada_em ? ` · ${formatDateTimeBr(envio.enviada_em)}` : ""}
                      </p>
                      <div className="opacity-80">
                        <GravacaoExternaArquivosPanel
                          ano={selected.ano}
                          nrOs={selected.nr_os}
                          arquivos={envio.arquivos}
                          selection={
                            previewSelection?.sessionId === envio.gravacao_pendente_id
                              ? previewSelection
                              : null
                          }
                          groupByMachine
                          chapasPorMaquina={envio.chapas}
                          onSelect={(arq) =>
                            setPreviewSelection({
                              kind: "file",
                              arquivo: arq,
                              sessionId: envio.gravacao_pendente_id,
                            })
                          }
                          onSelectComposite={(chapa) =>
                            setPreviewSelection({
                              kind: "composite",
                              groupKey: chapa.groupKey,
                              chapaLabel: chapa.chapaLabel,
                              displayLabel: chapa.displayLabel,
                              sessionId: envio.gravacao_pendente_id,
                            })
                          }
                          getDownloadUrl={(a, n, arquivoId) =>
                            gravacaoPendenteDownloadUrl(
                              a,
                              n,
                              arquivoId,
                              envio.gravacao_pendente_id,
                            )
                          }
                        />
                      </div>
                    </div>
                  ))}
                </section>
              );
            })}
          </div>
        </div>
        <div className="flex min-h-[280px] min-w-0 flex-col overflow-hidden lg:min-h-0 lg:h-full">
          <GravacaoExternaPreview
            ano={selected.ano}
            nrOs={selected.nr_os}
            selection={previewSelection}
            getPreviewUrl={getPendentePreviewUrl}
            getCompositePreviewUrl={getPendenteCompositeUrl}
            getDownloadUrl={getPendenteDownloadUrl}
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

      <GravacaoPendenteAdicionarOsModal
        open={adicionarModalOpen}
        saving={adicionarMutation.isPending}
        onClose={() => setAdicionarModalOpen(false)}
        onConfirm={(row, result) => {
          void adicionarMutation
            .mutateAsync({
              ano: row.ano,
              nrOs: row.nr_os,
              body: {
                arquivos: result.arquivos,
                chapas: result.chapas,
                observacao: result.obs,
                juntadas: result.juntadas,
                componente: result.componente,
              },
            })
            .then(() => {
              setAdicionarModalOpen(false);
              window.alert("OS adicionada à lista de Gravação Pendente.");
            })
            .catch((error) => {
              window.alert(
                error instanceof Error
                  ? error.message
                  : "Não foi possível adicionar a OS.",
              );
            });
        }}
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
