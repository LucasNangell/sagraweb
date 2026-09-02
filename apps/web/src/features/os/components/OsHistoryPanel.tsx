import { cn } from "@sagra/ui";
import { Link } from "@tanstack/react-router";
import { Search, Trash2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { queryKeys } from "@/api/query-keys";

import { useSetoresLookup, useSituacoesLookup } from "@/api/hooks/useAuxLookups";
import { useOsHistory, useOsHistoryMutations } from "@/api/hooks/useOsHistory";
import {
  useOsComponentes,
  useSubOsHistory,
  useSubOsHistoryMutations,
  useSubOsList,
} from "@/api/hooks/useSubOs";
import {
  addOsHistory,
  addSubOsHistory,
  checkOsVinculoReplicacao,
  createOrGetSubOs,
  createVinculoExcecao,
  fetchOsHistory,
  fetchSubOsHistory,
} from "@/api/os";
import {
  analiseButtonCaption,
  canEditAnalisePreview,
  hasProblemasTecnicosAndamento,
  resolveAnaliseButtonMode,
} from "@/features/analise/analiseAccess";
import { useAccessControl } from "@/features/auth/useAccessControl";
import { useAuthStore } from "@/features/auth/authStore";
import { formatDateBr, formatPonto, sanitizePontoDigits } from "@/lib/format";
import { homeTestIds } from "@/lib/testId";
import {
  formatAndamentoObsHoraStamp,
  insertAndamentoObsHoraStamp,
} from "../andamentoObsHoraStamp";
import { dedupeOsHistoryRows } from "../osHistoryUtils";
import { silentRefreshOsSearch } from "../osRealtimeSync";
import { useOsFiltersStore } from "../osFiltersStore";
import { useOsEditLock } from "../hooks/useOsEditLock";
import { sharedSetorIfAllTogether } from "../subOsUnir";
import { toMainOsSelection } from "../osTableRows";
import { useOsSelectionStore } from "../osSelectionStore";
import type {
  HistoryPayload,
  OsHistoryRow,
  OsSearchRow,
  OsVinculoGrupoMembro,
  ProtocoloEntregaPayload,
  SubOsHistoryRow,
} from "../types";
import { OsDecisaoSaidaModal } from "./OsDecisaoSaidaModal";
import { OsUnirSubOsModal } from "./OsUnirSubOsModal";
import { OsGravacaoAlterarArquivosButton } from "./OsGravacaoAlterarArquivosButton";
import { OsEntregaModal } from "./OsEntregaModal";
import {
  GravacaoPendenteLaunchModal,
  type GravacaoPendenteLaunchResult,
} from "@/features/gravacao-externa/components/GravacaoPendenteLaunchModal";
import { GravacaoConcluirInterceptModal } from "@/features/gravacao-externa/components/GravacaoConcluirInterceptModal";
import {
  isEmGravacaoExternaOperacional,
  isGravacaoPendenteSituacao,
  SETOR_GRAVACAO_PENDENTE,
} from "@/features/gravacao-externa/constants";
import { concluirGravacaoExterna } from "@/api/gravacaoExterna";

interface OsHistoryPanelProps {
  selected: OsSearchRow | null;
  flash?: boolean;
  embedded?: boolean;
  onEditingChange?: (editing: boolean) => void;
}

interface HistoryFormState {
  situacao: string;
  setor: string;
  obs: string;
  usuario: string;
}

const emptyForm = (): HistoryFormState => ({
  situacao: "",
  setor: "",
  obs: "",
  usuario: "",
});

const FROZEN_SITUACOES = new Set(["Entregue", "Cancelada", "Cancelado"]);

/** Oculto no frontend até o teste da feature de destino por componente terminar. */
const SHOW_COMPONENTE_ESPECIFICO = false;

function isEntregueSituacao(situacao: string): boolean {
  return situacao.trim() === "Entregue";
}

function formatUsuarioPontoLabel(
  ponto: string | number | null | undefined,
  nome: string | null | undefined,
): string {
  const pontoLabel = formatPonto(ponto);
  const nomeLabel = (nome ?? "").trim();
  if (!pontoLabel || !nomeLabel) {
    return pontoLabel;
  }
  return `${pontoLabel} (${nomeLabel})`;
}

function pontoFromUsuarioLabel(value: string): string {
  const pontoOnly = value.split("(", 1)[0] ?? value;
  return sanitizePontoDigits(pontoOnly);
}

/** "" = não escolhido; "main" = OS principal; "sub:123" = Sub OS; "comp:456" = componente sem Sub OS */
type AndamentoTargetKey = "" | "main" | `sub:${number}` | `comp:${number}`;

interface DestinationOption {
  key: AndamentoTargetKey;
  label: string;
}

function isOsFrozen(row: OsSearchRow | null): boolean {
  if (!row) return false;
  if (row.is_sub_os) return Boolean(row.congelada);
  return FROZEN_SITUACOES.has((row.situacao ?? "").trim());
}

export function OsHistoryPanel({
  selected,
  flash,
  embedded = false,
  onEditingChange,
}: OsHistoryPanelProps) {
  const queryClient = useQueryClient();
  const filters = useOsFiltersStore((s) => s.filters);
  const user = useAuthStore((s) => s.user);
  const { can } = useAccessControl();
  const isSubOs = Boolean(selected?.is_sub_os);
  const parentAno = selected?.parent_ano ?? selected?.ano ?? null;
  const parentId = selected?.parent_nr_os ?? selected?.nr_os ?? null;
  const ano = parentAno;
  const id = parentId;
  const subOsId = isSubOs ? (selected?.sub_os_id ?? null) : null;
  const osAno = ano != null ? Number(ano) : null;
  const osId = id != null ? Number(id) : null;
  const lock = useOsEditLock({
    ano: osAno,
    id: osId,
    origem: "andamento",
  });

  const historyQuery = useOsHistory(osAno, osId);
  const subHistoryQuery = useSubOsHistory(ano, id, subOsId);
  const subOsListQuery = useSubOsList(ano, id, Boolean(selected));
  const componentesQuery = useOsComponentes(ano, id, {
    enabled: Boolean(selected) && !isSubOs,
  });
  const { addMutation, updateMutation, deleteMutation, replicateMutation } =
    useOsHistoryMutations(isSubOs ? null : ano, isSubOs ? null : id);
  const { addMutation: addSubOsMutation, deleteMutation: deleteSubOsMutation } =
    useSubOsHistoryMutations(ano, id, subOsId);

  const activeSubOsList = subOsListQuery.data ?? [];
  const activeComponents = useMemo(
    () => (componentesQuery.data ?? []).filter((c) => c.ativo),
    [componentesQuery.data],
  );

  const destinationOptions = useMemo((): DestinationOption[] => {
    if (!selected || isSubOs) {
      return [];
    }
    const options: DestinationOption[] = [];
    const componentIdsWithSubOs = new Set(
      activeSubOsList.map((s) => s.componente_id),
    );
    for (const sub of activeSubOsList) {
      options.push({ key: `sub:${sub.id}`, label: sub.display_name });
    }
    for (const comp of activeComponents) {
      if (!componentIdsWithSubOs.has(comp.id)) {
        options.push({
          key: `comp:${comp.id}`,
          label: `${selected.nr_os} [${comp.nome}]`,
        });
      }
    }
    return options;
  }, [selected, isSubOs, activeSubOsList, activeComponents]);

  /** Só distingue componente quando o trabalho tem mais de um. */
  const needsDestinationSelector =
    !isSubOs && activeComponents.length > 1;

  const situacoesQuery = useSituacoesLookup();
  const setoresQuery = useSetoresLookup();

  const [editing, setEditing] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [selectedHistory, setSelectedHistory] = useState<OsHistoryRow | null>(
    null,
  );
  const [form, setForm] = useState<HistoryFormState>(emptyForm);
  const [pendingSaida, setPendingSaida] = useState<HistoryPayload | null>(null);
  const [pendingGrupoMembros, setPendingGrupoMembros] = useState<
    OsVinculoGrupoMembro[]
  >([]);
  const [pendingReplicacaoOrigem, setPendingReplicacaoOrigem] = useState<
    "juntada" | "vinculo" | null
  >(null);
  const [andamentoTarget, setAndamentoTarget] = useState<AndamentoTargetKey>("");
  const [componenteEspecifico, setComponenteEspecifico] = useState(false);
  const [tourSaved, setTourSaved] = useState(false);
  const [entregaModalOpen, setEntregaModalOpen] = useState(false);
  const [gravacaoPendenteModalOpen, setGravacaoPendenteModalOpen] = useState(false);
  const [gravacaoInterceptOpen, setGravacaoInterceptOpen] = useState(false);
  const [gravacaoInterceptSaving, setGravacaoInterceptSaving] = useState(false);
  const [gravacaoInterceptChapas, setGravacaoInterceptChapas] = useState<
    { maquina: string; quantidade: number }[]
  >([]);
  const [pendingAfterConcluir, setPendingAfterConcluir] = useState<HistoryPayload | null>(
    null,
  );
  const [unirModalOpen, setUnirModalOpen] = useState(false);
  const [pendingUnirPayload, setPendingUnirPayload] = useState<HistoryPayload | null>(
    null,
  );
  const [selectedSubHistory, setSelectedSubHistory] =
    useState<SubOsHistoryRow | null>(null);

  useEffect(() => {
    onEditingChange?.(editing);
  }, [editing, onEditingChange]);

  useEffect(() => {
    return () => {
      onEditingChange?.(false);
    };
  }, [onEditingChange]);

  const historyOsKey =
    ano != null && id != null
      ? `${ano}:${id}${isSubOs ? `:sub:${subOsId}` : ""}`
      : null;

  const historyQueryEnabled = osAno != null && osId != null;

  /** Só exibe linhas após fetch da OS atual (deduplicadas por CodStatus). */
  const rows = useMemo(() => {
    if (!historyQueryEnabled) {
      return [];
    }
    if (isSubOs) {
      if (subHistoryQuery.isPending) return [];
      return subHistoryQuery.data ?? [];
    }
    if (historyQuery.isPending) {
      return [];
    }
    return dedupeOsHistoryRows(historyQuery.data ?? []);
  }, [
    historyQueryEnabled,
    isSubOs,
    historyQuery.isPending,
    historyQuery.data,
    subHistoryQuery.isPending,
    subHistoryQuery.data,
  ]);

  const showHistoryLoading =
    !historyQueryEnabled ||
    (isSubOs
      ? subHistoryQuery.isPending ||
        (subHistoryQuery.isFetching && rows.length === 0)
      : historyQuery.isPending ||
        (historyQuery.isFetching && rows.length === 0));

  const frozen = isOsFrozen(selected);

  const lastAutoKeyRef = useRef<string | null>(null);
  const historyListRef = useRef<HTMLDivElement>(null);
  const obsTextareaRef = useRef<HTMLTextAreaElement>(null);
  const pendingObsCursorRef = useRef<number | null>(null);

  const resetForm = useCallback(() => {
    void lock.release();
    setEditing(false);
    setIsEditMode(false);
    setForm(emptyForm());
  }, [lock.release]);

  const selectHistoryRow = useCallback((row: OsHistoryRow) => {
    setSelectedHistory(row);
    setForm({
      situacao: row.SituacaoLink ?? "",
      setor: row.SetorLink ?? "",
      obs: row.Observaçao ?? "",
      usuario: formatUsuarioPontoLabel(row.Ponto, row.usuario_nome),
    });
    if (!editing) {
      setIsEditMode(false);
    }
  }, [editing]);

  useEffect(() => {
    resetForm();
    setSelectedHistory(null);
    setSelectedSubHistory(null);
    setAndamentoTarget(
      isSubOs && subOsId != null ? (`sub:${subOsId}` as AndamentoTargetKey) : "",
    );
    setComponenteEspecifico(false);
    lastAutoKeyRef.current = null;
  }, [ano, id, isSubOs, subOsId, resetForm]);

  useEffect(() => {
    if (!selected || rows.length === 0 || editing) {
      return;
    }
    const last = rows[rows.length - 1];
    if (!last) {
      return;
    }
    const key = isSubOs
      ? `${ano}-${id}-sub-${(last as SubOsHistoryRow).id}`
      : `${ano}-${id}-${(last as OsHistoryRow).CodStatus}`;
    if (lastAutoKeyRef.current === key) {
      return;
    }
    lastAutoKeyRef.current = key;
    if (isSubOs) {
      const subRow = last as SubOsHistoryRow;
      setSelectedSubHistory(subRow);
      setForm({
        situacao: subRow.situacao ?? "",
        setor: subRow.setor ?? "",
        obs: subRow.observacao ?? "",
        usuario: formatUsuarioPontoLabel(subRow.ponto, subRow.usuario_nome),
      });
    } else {
      selectHistoryRow(last as OsHistoryRow);
    }
  }, [rows, selected, editing, ano, id, isSubOs, selectHistoryRow]);

  useEffect(() => {
    if (
      !selected ||
      historyQuery.isPending ||
      historyQuery.isFetching ||
      rows.length === 0
    ) {
      return;
    }
    const list = historyListRef.current;
    if (!list) {
      return;
    }
    const frame = requestAnimationFrame(() => {
      list.scrollTop = list.scrollHeight;
    });
    return () => cancelAnimationFrame(frame);
  }, [
    selected,
    ano,
    id,
    historyQuery.isPending,
    historyQuery.isFetching,
    rows.length,
  ]);

  useEffect(() => {
    const pos = pendingObsCursorRef.current;
    if (pos == null) {
      return;
    }
    pendingObsCursorRef.current = null;
    const el = obsTextareaRef.current;
    if (!el) {
      return;
    }
    el.focus();
    el.setSelectionRange(pos, pos);
    el.scrollTop = el.scrollHeight;
  }, [form.obs]);

  const canSaveNew = useMemo(() => {
    if (!editing || isEditMode) {
      return true;
    }
    if (isSubOs) {
      return true;
    }
    if (!needsDestinationSelector || !componenteEspecifico) {
      return true;
    }
    return (
      andamentoTarget.startsWith("sub:") || andamentoTarget.startsWith("comp:")
    );
  }, [
    editing,
    isEditMode,
    isSubOs,
    needsDestinationSelector,
    componenteEspecifico,
    andamentoTarget,
  ]);

  const startNew = async () => {
    if (frozen) {
      window.alert("OS congelada (Entregue/Cancelada) — andamento bloqueado.");
      return;
    }
    const ok = await lock.acquire();
    if (!ok) return;
    setIsEditMode(false);
    setEditing(true);
    setTourSaved(false);
    setSelectedHistory(null);
    setSelectedSubHistory(null);
    setAndamentoTarget(
      isSubOs && subOsId != null
        ? (`sub:${subOsId}` as AndamentoTargetKey)
        : "main",
    );
    setComponenteEspecifico(false);
    setForm({
      situacao: "",
      setor: "",
      obs: "",
      usuario: user ? formatUsuarioPontoLabel(user.ponto, user.nome) : "",
    });
  };

  const startEdit = async () => {
    if (!selectedHistory) {
      window.alert("Selecione um andamento na lista para editar.");
      return;
    }
    const ok = await lock.acquire();
    if (!ok) return;
    setIsEditMode(true);
    setEditing(true);
  };

  const showObsHoraButton = editing && isEditMode;

  const insertHoraStamp = () => {
    const stamp = formatAndamentoObsHoraStamp(new Date(), user?.nome ?? "");
    setForm((f) => {
      const { text, cursor } = insertAndamentoObsHoraStamp(f.obs, stamp);
      pendingObsCursorRef.current = cursor;
      return { ...f, obs: text };
    });
  };

  const cancelEdit = () => {
    void lock.release();
    setEditing(false);
    setIsEditMode(false);
    setComponenteEspecifico(false);
    setAndamentoTarget(
      isSubOs && subOsId != null ? (`sub:${subOsId}` as AndamentoTargetKey) : "",
    );
    if (selectedHistory) {
      selectHistoryRow(selectedHistory);
    } else {
      setForm(emptyForm());
    }
  };

  const buildPayload = (): HistoryPayload => ({
    situacao: form.situacao,
    setor: form.setor,
    obs: form.obs,
    usuario: pontoFromUsuarioLabel(form.usuario),
    confirm_main_os_target: true,
  });

  const refreshAfterSubOsSave = async (targetSubId: number) => {
    if (!selected || ano == null || id == null) {
      return;
    }
    const [mainHistory, subHistory] = await Promise.all([
      fetchOsHistory(ano, id),
      fetchSubOsHistory(ano, id, targetSubId),
    ]);
    queryClient.setQueryData(
      queryKeys.os.history(ano, id),
      dedupeOsHistoryRows(mainHistory),
    );
    queryClient.setQueryData(
      queryKeys.os.subOsHistory(ano, id, targetSubId),
      subHistory,
    );
    queryClient.invalidateQueries({ queryKey: queryKeys.os.subOs(ano, id) });
    queryClient.invalidateQueries({
      queryKey: queryKeys.os.subOsSummary(ano, id),
    });
    await silentRefreshOsSearch(queryClient, undefined, {
      skipCrossTabLock: true,
    });
  };

  const refreshAfterUnir = async () => {
    if (!selected || ano == null || id == null) {
      return;
    }
    const mainHistory = await fetchOsHistory(ano, id);
    queryClient.setQueryData(
      queryKeys.os.history(ano, id),
      dedupeOsHistoryRows(mainHistory),
    );
    queryClient.invalidateQueries({ queryKey: queryKeys.os.subOs(ano, id) });
    queryClient.invalidateQueries({
      queryKey: queryKeys.os.subOsSummary(ano, id),
    });
    await silentRefreshOsSearch(queryClient, undefined, {
      skipCrossTabLock: true,
    });
    const current = useOsSelectionStore.getState().selected;
    if (current?.is_sub_os || current?.kind === "sub_os") {
      useOsSelectionStore.getState().setSelected(toMainOsSelection(current));
    }
  };

  const saveHistory = async (payloadOverride?: HistoryPayload) => {
    if (!selected) {
      window.alert("Selecione uma OS primeiro.");
      return;
    }
    if (frozen) {
      window.alert("OS congelada (Entregue/Cancelada) — andamento bloqueado.");
      return;
    }
    if (!form.situacao || !form.setor) {
      window.alert("Preencha Situação e Setor.");
      return;
    }
    if (!canSaveNew) {
      window.alert("Selecione o componente para lançar o andamento.");
      return;
    }

    const payload = payloadOverride ?? buildPayload();
    const launchingOnMainOs =
      !isSubOs &&
      !andamentoTarget.startsWith("sub:") &&
      !andamentoTarget.startsWith("comp:");
    const lastHistForGuard =
      dedupeOsHistoryRows(historyQuery.data ?? []).at(-1) ?? null;

    if (
      !payloadOverride &&
      !isEditMode &&
      isEntregueSituacao(form.situacao) &&
      launchingOnMainOs
    ) {
      setEntregaModalOpen(true);
      return;
    }

    if (
      !payloadOverride &&
      !isEditMode &&
      isGravacaoPendenteSituacao(form.situacao) &&
      launchingOnMainOs
    ) {
      setGravacaoPendenteModalOpen(true);
      return;
    }

    if (
      !payloadOverride &&
      !isEditMode &&
      launchingOnMainOs &&
      isEmGravacaoExternaOperacional(
        lastHistForGuard?.SituacaoLink,
        lastHistForGuard?.SetorLink,
      )
    ) {
      setPendingAfterConcluir(payload);
      setGravacaoInterceptChapas([]);
      setGravacaoInterceptOpen(true);
      return;
    }

    const unirSetor = sharedSetorIfAllTogether(activeSubOsList);
    if (!payloadOverride && !isEditMode && unirSetor) {
      setPendingUnirPayload(payload);
      setUnirModalOpen(true);
      return;
    }

    let targetSubId: number | null =
      isSubOs && subOsId != null
        ? subOsId
        : andamentoTarget.startsWith("sub:")
          ? Number(andamentoTarget.slice(4))
          : null;

    try {
      if (payload.unir_sub_os) {
        await addOsHistory(ano!, id!, {
          ...payload,
          confirm_main_os_target: true,
          unir_sub_os: true,
        });
        await refreshAfterUnir();
      } else {
        if (andamentoTarget.startsWith("comp:")) {
          const compId = Number(andamentoTarget.slice(5));
          const sub = await createOrGetSubOs(ano!, id!, compId);
          targetSubId = sub.id;
        }

        if (targetSubId != null) {
          if (isEditMode) {
            window.alert("Edição de andamento de Sub OS não disponível nesta versão.");
            return;
          }
          if (isSubOs) {
            await addSubOsMutation.mutateAsync(payload);
          } else {
            await addSubOsHistory(ano!, id!, targetSubId, payload);
            await refreshAfterSubOsSave(targetSubId);
          }
        } else if (isEditMode && selectedHistory) {
          await updateMutation.mutateAsync({
            ...payload,
            cod_status: selectedHistory.CodStatus,
          });
        } else {
          const isGravacaoPendenteLaunch =
            Array.isArray(payload.gravacao_pendente_arquivos) ||
            Array.isArray(payload.gravacao_pendente_chapas) ||
            Array.isArray(payload.gravacao_pendente_juntadas);
          if (!isGravacaoPendenteLaunch) {
            const replicacao = await checkOsVinculoReplicacao(
              ano!,
              id!,
              form.situacao,
              form.setor,
            );
            if (replicacao.requires_confirmation) {
              setPendingGrupoMembros(replicacao.membros ?? []);
              setPendingReplicacaoOrigem(
                replicacao.origem === "juntada" ? "juntada" : "vinculo",
              );
              setPendingSaida(payload);
              return;
            }
          }
          await addMutation.mutateAsync(payload);
        }
      }
      setTourSaved(true);
      resetForm();
      setAndamentoTarget(
        isSubOs && subOsId != null && !payload.unir_sub_os
          ? (`sub:${subOsId}` as AndamentoTargetKey)
          : "",
      );
      setComponenteEspecifico(false);
    } catch (e) {
      window.alert(
        `Erro ao salvar: ${e instanceof Error ? e.message : "falha"}`,
      );
    }
  };

  const handleEntregaConfirm = (entrega: ProtocoloEntregaPayload) => {
    setEntregaModalOpen(false);
    void saveHistory({ ...buildPayload(), protocolo_entrega: entrega });
  };

  const handleUnirConfirm = (unir: boolean) => {
    setUnirModalOpen(false);
    const pending = pendingUnirPayload;
    setPendingUnirPayload(null);
    if (!pending) {
      return;
    }
    if (unir) {
      void saveHistory({
        ...pending,
        confirm_main_os_target: true,
        unir_sub_os: true,
      });
      return;
    }
    const hasComponentTarget =
      isSubOs ||
      andamentoTarget.startsWith("sub:") ||
      andamentoTarget.startsWith("comp:");
    if (!hasComponentTarget) {
      window.alert("Selecione o componente para lançar o andamento.");
      setComponenteEspecifico(true);
      setAndamentoTarget("");
      return;
    }
    void saveHistory(pending);
  };

  const handleGravacaoPendenteConfirm = (result: GravacaoPendenteLaunchResult) => {
    setGravacaoPendenteModalOpen(false);
    void saveHistory({
      ...buildPayload(),
      setor: SETOR_GRAVACAO_PENDENTE,
      obs: result.obs || form.obs,
      gravacao_pendente_arquivos: result.arquivos.map((f) => ({
        absolute_path: f.absolute_path,
        nome: f.nome,
        maquina: f.maquina ?? null,
      })),
      gravacao_pendente_chapas: result.chapas,
      gravacao_pendente_juntadas: result.juntadas.map((j) => ({
        numero: j.nr_os,
        ano: j.ano,
      })),
    });
  };

  const handleGravacaoInterceptConfirm = async () => {
    if (!selected || !pendingAfterConcluir) return;
    setGravacaoInterceptSaving(true);
    try {
      await concluirGravacaoExterna(selected.ano, selected.nr_os);
      const nextPayload = pendingAfterConcluir;
      setGravacaoInterceptOpen(false);
      setPendingAfterConcluir(null);
      await saveHistory(nextPayload);
      void queryClient.invalidateQueries({
        queryKey: queryKeys.gravacaoExterna.prefix,
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.os.history(selected.ano, selected.nr_os),
      });
    } catch (e) {
      window.alert(
        `Erro ao concluir Gravação Externa: ${e instanceof Error ? e.message : "falha"}`,
      );
    } finally {
      setGravacaoInterceptSaving(false);
    }
  };

  const handleDelete = async () => {
    if (isSubOs) {
      if (!selectedSubHistory) {
        window.alert("Selecione um andamento para excluir.");
        return;
      }
      const label =
        selected?.display_label ??
        `${selected?.nr_os} [${selected?.componente_nome ?? "Componente"}]`;
      const inherited = Boolean(selectedSubHistory.herdado_da_os_principal);
      const confirmMsg = inherited
        ? `Excluir andamento herdado da Sub OS ${label}?\n\nIsso remove apenas o status herdado deste componente. O andamento da OS principal não será alterado.`
        : `Excluir andamento da Sub OS ${label}?`;
      if (!window.confirm(confirmMsg)) {
        return;
      }
      try {
        await deleteSubOsMutation.mutateAsync(selectedSubHistory.id);
        window.alert("Andamento da Sub OS excluído.");
        setSelectedSubHistory(null);
        setForm(emptyForm());
      } catch (e) {
        window.alert(
          `Erro ao excluir: ${e instanceof Error ? e.message : "falha"}`,
        );
      }
      return;
    }

    if (!selectedHistory) {
      window.alert("Selecione um andamento para excluir.");
      return;
    }
    const confirmMsg =
      "ATENÇÃO: Deseja excluir este andamento?\n\n" +
      "Andamentos herdados ou espelhados nas Sub OSs correspondentes também serão removidos.\n\n" +
      "Isso irá reorganizar a numeração de todos os andamentos desta OS.\n" +
      "Essa ação não pode ser desfeita.";
    if (!window.confirm(confirmMsg)) {
      return;
    }
    try {
      await deleteMutation.mutateAsync(selectedHistory.CodStatus);
      window.alert("Andamento excluído e lista reorganizada.");
      setSelectedHistory(null);
      setForm(emptyForm());
    } catch (e) {
      window.alert(
        `Erro ao excluir: ${e instanceof Error ? e.message : "falha"}`,
      );
    }
  };

  const handleDecisao = async (choice: "all" | "single") => {
    if (!selected || !pendingSaida) {
      return;
    }
    const origem = pendingReplicacaoOrigem;
    const payload = pendingSaida;
    setPendingSaida(null);
    setPendingGrupoMembros([]);
    setPendingReplicacaoOrigem(null);
    try {
      if (choice === "all") {
        await replicateMutation.mutateAsync({
          ...payload,
          replicar_alvo: origem === "juntada" ? "juntada" : "vinculo",
        });
        window.alert(
          origem === "juntada"
            ? "Andamento replicado para as OSs juntadas."
            : "Andamento replicado para o grupo.",
        );
      } else {
        await addMutation.mutateAsync(payload);
        if (origem === "vinculo") {
          await createVinculoExcecao(selected.ano, selected.nr_os, {
            observacao: "Andamento divergente aplicado apenas a esta OS",
            usuario_ponto: payload.usuario,
            situacao: payload.situacao,
            setor: payload.setor,
          });
          window.alert(
            "Andamento salvo apenas nesta OS. O criador do vínculo foi notificado.",
          );
        } else {
          window.alert("Andamento salvo apenas nesta OS.");
        }
      }
      setTourSaved(true);
      resetForm();
    } catch (e) {
      window.alert(
        `Erro ao aplicar decisão: ${e instanceof Error ? e.message : "falha"}`,
      );
    }
  };

  const saving =
    addMutation.isPending ||
    updateMutation.isPending ||
    deleteMutation.isPending ||
    replicateMutation.isPending ||
    addSubOsMutation.isPending ||
    deleteSubOsMutation.isPending;

  const panelTitle = isSubOs
    ? `HISTÓRICO — ${selected?.display_label ?? selected?.componente_nome ?? "Sub OS"}`
    : "HISTÓRICO DE TRAMITAÇÃO";

  const mainHistoryRows = useMemo(
    () => dedupeOsHistoryRows(historyQuery.data ?? []),
    [historyQuery.data],
  );
  const lastMainHistory = mainHistoryRows[mainHistoryRows.length - 1] ?? null;
  const historyHasProblemasTecnicos =
    hasProblemasTecnicosAndamento(mainHistoryRows);

  const analiseCanEdit = canEditAnalisePreview({
    userSetor: user?.setor,
    situacao: lastMainHistory?.SituacaoLink,
    lastPonto: lastMainHistory?.Ponto,
    currentPonto: user?.ponto,
  });
  const analiseMode = resolveAnaliseButtonMode({
    canEdit: analiseCanEdit,
    hasProblemasTecnicos: historyHasProblemasTecnicos,
    currentSituacao: lastMainHistory?.SituacaoLink,
  });

  const showAnaliseButton =
    !editing &&
    Boolean(selected) &&
    can("sb_analise") &&
    selected != null &&
    selected.nr_os < 5000 &&
    osAno != null &&
    osId != null &&
    analiseMode != null;

  const analiseCaption = analiseMode
    ? analiseButtonCaption(analiseMode)
    : "";


  return (
    <>
      <section
        data-tour="os-history-panel"
        data-testid={homeTestIds.osHistoryPanel}
        data-tour-editing={editing ? "true" : "false"}
        data-tour-frozen={frozen ? "true" : "false"}
        data-tour-saved={tourSaved ? "true" : "false"}
        className={cn(
          "flex min-h-0 flex-1 flex-col transition-shadow",
          embedded
            ? ""
            : "rounded-lg border border-sagra-border bg-white shadow-sm",
          flash && "ring-2 ring-inset ring-primary-green/40",
        )}
      >
        <div className="shrink-0 border-b border-sagra-border bg-slate-50/80 px-3 py-1.5">
          <h3 className="text-xs font-bold tracking-wide text-secondary-blue">
            {panelTitle}
          </h3>
          {isSubOs && selected?.componente_nome ? (
            <p className="mt-0.5 text-[0.65rem] font-semibold text-amber-800">
              Componente: {selected.componente_nome}
              {frozen ? " — congelada" : ""}
            </p>
          ) : null}
        </div>

        {!selected && (
          <p className="flex flex-1 items-center justify-center p-4 text-sm text-neutral-500">
            Selecione uma OS para ver o histórico.
          </p>
        )}

        {selected && (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden sm:flex-row">
            <div
              ref={historyListRef}
              className={cn(
                "relative max-h-[min(40vh,280px)] min-h-[140px] min-w-0 shrink-0 overflow-y-auto overscroll-contain border-b border-sagra-border sm:max-h-none sm:h-auto sm:w-[45.6%] sm:border-r sm:border-b-0",
                editing && "cursor-not-allowed",
              )}
            >
              {editing ? (
                <div
                  className="absolute inset-0 z-10 cursor-not-allowed bg-white/40"
                  aria-hidden
                />
              ) : null}
              <table
                className={cn(
                  "w-full border-collapse text-xs",
                  editing && "pointer-events-none opacity-60",
                )}
              >
                <thead className="sticky top-0 bg-slate-100">
                  <tr>
                    <th className="px-2 py-1.5 text-left font-semibold">
                      Situação
                    </th>
                    <th className="px-2 py-1.5 text-left font-semibold">Setor</th>
                    <th className="px-2 py-1.5 text-left font-semibold">Data</th>
                  </tr>
                </thead>
                <tbody key={historyOsKey ?? "empty"}>
                  {showHistoryLoading ? (
                    <tr>
                      <td
                        colSpan={3}
                        className="px-2 py-4 text-center text-neutral-500"
                      >
                        Carregando...
                      </td>
                    </tr>
                  ) : rows.length === 0 ? (
                    <tr>
                      <td
                        colSpan={3}
                        className="px-2 py-4 text-center text-neutral-500"
                      >
                        Nenhum andamento.
                      </td>
                    </tr>
                  ) : (
                    rows.map((row) => {
                      if (isSubOs) {
                        const subRow = row as SubOsHistoryRow;
                        const isRowSelected =
                          selectedSubHistory?.id === subRow.id;
                        return (
                          <tr
                            key={`${historyOsKey}-${subRow.id}`}
                            data-testid={homeTestIds.osHistoryRow(subRow.id)}
                            onClick={() => {
                              if (!editing) {
                                setSelectedSubHistory(subRow);
                                setForm({
                                  situacao: subRow.situacao ?? "",
                                  setor: subRow.setor ?? "",
                                  obs: subRow.observacao ?? "",
                                  usuario: formatUsuarioPontoLabel(
                                    subRow.ponto,
                                    subRow.usuario_nome,
                                  ),
                                });
                              }
                            }}
                            className={cn(
                              "cursor-pointer border-b border-sagra-border/50 hover:bg-slate-50",
                              isRowSelected && "bg-[var(--highlight-yellow)]",
                            )}
                          >
                            <td className="px-2 py-1">{subRow.situacao ?? "-"}</td>
                            <td className="px-2 py-1">{subRow.setor ?? "-"}</td>
                            <td className="px-2 py-1">
                              {formatDateBr(subRow.data ?? undefined)}
                            </td>
                          </tr>
                        );
                      }
                      const mainRow = row as OsHistoryRow;
                      const isRowSelected =
                        selectedHistory?.CodStatus === mainRow.CodStatus;
                      return (
                        <tr
                          key={`${historyOsKey}-${mainRow.CodStatus}`}
                          data-testid={homeTestIds.osHistoryRow(mainRow.CodStatus)}
                          onClick={() => {
                            if (!editing) {
                              selectHistoryRow(mainRow);
                            }
                          }}
                          className={cn(
                            "cursor-pointer border-b border-sagra-border/50 hover:bg-slate-50",
                            isRowSelected && "bg-[var(--highlight-yellow)]",
                          )}
                        >
                          <td className="px-2 py-1">
                            {mainRow.SituacaoLink ?? "-"}
                          </td>
                          <td className="px-2 py-1">{mainRow.SetorLink ?? "-"}</td>
                          <td className="px-2 py-1">{formatDateBr(mainRow.Data)}</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden p-2">
              <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain">
                <div className="flex min-h-full flex-col gap-2">
                  {editing && frozen ? (
                    <p className="shrink-0 text-xs font-semibold text-amber-800">
                      OS congelada — não é permitido novo andamento.
                    </p>
                  ) : null}

                  <div className="grid shrink-0 grid-cols-1 gap-1.5 sm:grid-cols-3">
                    <label className="min-w-0 text-xs" data-tour="os-history-situacao" data-testid={homeTestIds.osHistorySituacao}>
                      <span className="font-semibold text-neutral-600">Andamento</span>
                      <select
                        value={form.situacao}
                        disabled={!editing}
                        onChange={(e) =>
                          setForm((f) => ({ ...f, situacao: e.target.value }))
                        }
                        className="mt-0.5 h-8 w-full rounded border border-sagra-border px-1 text-xs disabled:bg-slate-50"
                      >
                        <option value="">Selecione...</option>
                        {(situacoesQuery.data ?? []).map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="min-w-0 text-xs" data-tour="os-history-setor" data-testid={homeTestIds.osHistorySetor}>
                      <span className="font-semibold text-neutral-600">Setor</span>
                      <select
                        value={form.setor}
                        disabled={!editing}
                        onChange={(e) =>
                          setForm((f) => ({ ...f, setor: e.target.value }))
                        }
                        className="mt-0.5 h-8 w-full rounded border border-sagra-border px-1 text-xs disabled:bg-slate-50"
                      >
                        <option value="">Selecione...</option>
                        {(setoresQuery.data ?? []).map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="min-w-0 text-xs" data-tour="os-history-ponto" data-testid={homeTestIds.osHistoryPonto}>
                      <span className="font-semibold text-neutral-600">Ponto</span>
                      <input
                        type="text"
                        value={form.usuario}
                        disabled={!editing}
                        onChange={(e) =>
                          setForm((f) => ({ ...f, usuario: e.target.value }))
                        }
                        className="mt-0.5 h-8 w-full rounded border border-sagra-border px-2 text-xs disabled:bg-slate-50"
                      />
                    </label>
                  </div>

                  {SHOW_COMPONENTE_ESPECIFICO &&
                  editing &&
                  !isEditMode &&
                  needsDestinationSelector ? (
                    <div className="flex min-w-0 shrink-0 flex-col gap-1.5" data-tour="os-history-componente" data-testid={homeTestIds.osHistoryComponente}>
                      <label className="flex items-center gap-2 text-xs text-neutral-800">
                        <input
                          type="checkbox"
                          className="shrink-0"
                          checked={componenteEspecifico}
                          onChange={(e) => {
                            const checked = e.target.checked;
                            setComponenteEspecifico(checked);
                            setAndamentoTarget(checked ? "" : "main");
                          }}
                        />
                        <span>Componente específico</span>
                      </label>
                      {componenteEspecifico ? (
                        <label className="min-w-0 text-xs">
                          <span className="font-semibold text-neutral-700">
                            Lançar andamento em: *
                          </span>
                          <select
                            value={andamentoTarget}
                            onChange={(e) => {
                              setAndamentoTarget(
                                e.target.value as AndamentoTargetKey,
                              );
                            }}
                            className="mt-0.5 h-8 w-full rounded border border-sagra-border px-1 text-xs"
                          >
                            <option value="">Selecione o destino...</option>
                            {destinationOptions.map((opt) => (
                              <option key={opt.key} value={opt.key}>
                                {opt.label}
                              </option>
                            ))}
                          </select>
                        </label>
                      ) : null}
                    </div>
                  ) : null}

                  <div
                    className="flex min-h-[5rem] min-w-0 flex-1 flex-col text-xs"
                    data-tour="os-history-obs"
                    data-testid={homeTestIds.osHistoryObs}
                  >
                    <div className="flex shrink-0 items-center justify-between gap-1">
                      <span className="font-semibold text-neutral-600">
                        Observação
                      </span>
                      {showObsHoraButton ? (
                        <button
                          type="button"
                          data-testid={homeTestIds.osHistoryObsHora}
                          aria-label="Inserir data e hora na observação"
                          onClick={insertHoraStamp}
                          className="rounded border border-sagra-border bg-white px-1.5 py-0.5 text-[10px] font-semibold text-neutral-700 hover:bg-slate-50"
                        >
                          Hora
                        </button>
                      ) : null}
                    </div>
                    <textarea
                      ref={obsTextareaRef}
                      value={form.obs}
                      disabled={!editing}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, obs: e.target.value }))
                      }
                      className="mt-0.5 min-h-[5rem] w-full flex-1 resize-none rounded border border-sagra-border px-2 py-1.5 text-xs disabled:bg-slate-50"
                    />
                  </div>
                </div>
              </div>

              <div className="flex shrink-0 items-center justify-between gap-2 border-t border-sagra-border/60 pt-2">
                {!(editing && !isEditMode) ? (
                  <button
                    type="button"
                    title="Excluir andamento selecionado"
                    disabled={
                      isSubOs
                        ? !selectedSubHistory || saving
                        : !selectedHistory || saving
                    }
                    onClick={() => void handleDelete()}
                    className="flex size-8 items-center justify-center rounded bg-sagra-danger text-white disabled:opacity-40"
                    data-testid={homeTestIds.osHistoryExcluir}
                  >
                    <Trash2 className="size-4" />
                  </button>
                ) : (
                  <span className="size-8" aria-hidden />
                )}

                <div className="flex flex-wrap gap-2">
                  {showAnaliseButton ? (
                    <Link
                      to="/analise"
                      search={{
                        ano: String(osAno),
                        id: String(osId),
                      }}
                      className="inline-flex items-center gap-1.5 rounded bg-secondary-blue px-3 py-1.5 text-xs font-semibold text-white no-underline hover:bg-secondary-blue/90 hover:text-white hover:no-underline"
                      data-testid={homeTestIds.osHistoryAnalise}
                    >
                      <Search className="size-3.5" aria-hidden />
                      {analiseCaption}
                    </Link>
                  ) : null}
                  {!editing && !isSubOs ? (
                    <OsGravacaoAlterarArquivosButton
                      selected={selected}
                      frozen={frozen}
                      disabled={saving}
                    />
                  ) : null}
                  {!editing ? (
                    <>
                      <button
                        type="button"
                        disabled={frozen || lock.acquiring}
                        onClick={() => void startNew()}
                        data-tour="os-history-novo"
                        data-testid={homeTestIds.osHistoryNovo}
                        className="rounded bg-primary-green px-4 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                      >
                        Novo
                      </button>
                      {!isSubOs ? (
                        <button
                          type="button"
                          onClick={() => void startEdit()}
                          disabled={lock.acquiring}
                          className="rounded bg-amber-500 px-4 py-1.5 text-xs font-semibold text-white"
                          data-testid={homeTestIds.osHistoryEditar}
                        >
                          Editar
                        </button>
                      ) : null}
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        disabled={saving || !canSaveNew}
                        onClick={() => void saveHistory()}
                        data-tour="os-history-salvar"
                        data-testid={homeTestIds.osHistorySalvar}
                        className="rounded bg-primary-green px-4 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
                      >
                        Salvar
                      </button>
                      <button
                        type="button"
                        disabled={saving}
                        onClick={cancelEdit}
                        className="rounded bg-sagra-danger px-4 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
                        data-testid={homeTestIds.osHistoryCancelar}
                      >
                        Cancelar
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </section>

      <OsUnirSubOsModal
        open={unirModalOpen}
        setor={sharedSetorIfAllTogether(activeSubOsList) ?? pendingUnirPayload?.setor ?? ""}
        osLabel={
          selected
            ? `${selected.parent_nr_os ?? selected.nr_os}/${selected.parent_ano ?? selected.ano}`
            : undefined
        }
        onClose={() => {
          setUnirModalOpen(false);
          setPendingUnirPayload(null);
        }}
        onConfirm={handleUnirConfirm}
      />

      <OsDecisaoSaidaModal
        open={pendingSaida != null}
        currentOs={
          selected
            ? { numero: selected.nr_os, ano: selected.ano }
            : null
        }
        situacao={pendingSaida?.situacao}
        setor={pendingSaida?.setor}
        membros={pendingGrupoMembros}
        origem={pendingReplicacaoOrigem}
        onClose={() => {
          setPendingSaida(null);
          setPendingGrupoMembros([]);
          setPendingReplicacaoOrigem(null);
        }}
        onConfirm={(choice) => void handleDecisao(choice)}
      />

      <OsEntregaModal
        open={entregaModalOpen}
        saving={saving}
        defaults={{
          nr_ponto: form.usuario,
          entregue_por: form.usuario,
          setor: form.setor,
        }}
        onClose={() => setEntregaModalOpen(false)}
        onConfirm={handleEntregaConfirm}
      />

      <GravacaoPendenteLaunchModal
        row={selected}
        open={gravacaoPendenteModalOpen}
        initialObs={form.obs}
        saving={saving}
        onClose={() => setGravacaoPendenteModalOpen(false)}
        onConfirm={handleGravacaoPendenteConfirm}
      />

      <GravacaoConcluirInterceptModal
        open={gravacaoInterceptOpen}
        osLabel={
          selected
            ? `${String(selected.nr_os).padStart(5, "0")}/${String(selected.ano).slice(-2)}`
            : ""
        }
        chapas={gravacaoInterceptChapas}
        pendingSituacao={pendingAfterConcluir?.situacao ?? form.situacao}
        pendingSetor={pendingAfterConcluir?.setor ?? form.setor}
        saving={gravacaoInterceptSaving || saving}
        onClose={() => {
          if (gravacaoInterceptSaving) return;
          setGravacaoInterceptOpen(false);
          setPendingAfterConcluir(null);
        }}
        onConfirm={() => void handleGravacaoInterceptConfirm()}
      />
    </>
  );
}
