import { cn } from "@sagra/ui";
import { Trash2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type Ref } from "react";

import { queryKeys } from "@/api/query-keys";
import { useSetoresLookup, useSituacoesLookup } from "@/api/hooks/useAuxLookups";
import { useOsHistoryMutations } from "@/api/hooks/useOsHistory";
import {
  useOsComponentes,
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
import { useAuthStore } from "@/features/auth/authStore";
import { formatDateBr, formatPonto, sanitizePontoDigits } from "@/lib/format";
import { homeTestIds } from "@/lib/testId";
import {
  formatAndamentoObsHoraStamp,
  insertAndamentoObsHoraStamp,
} from "../andamentoObsHoraStamp";
import { sortHistoryRowsNewestFirst } from "../osHistoryMultiselect";
import { dedupeOsHistoryRows } from "../osHistoryUtils";
import { silentRefreshOsSearch } from "../osRealtimeSync";
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
import { OsEntregaModal } from "./OsEntregaModal";
import {
  GravacaoPendenteLaunchModal,
  type GravacaoPendenteLaunchResult,
} from "@/features/gravacao-externa/components/GravacaoPendenteLaunchModal";
import {
  isGravacaoPendenteSituacao,
  SETOR_GRAVACAO_PENDENTE,
} from "@/features/gravacao-externa/constants";
import { buildGravacaoPendenteObservacaoPayload } from "../gravacaoPendenteObservacao";
import { toast } from "@/components/ui/toastStore";

interface HistoryFormState {
  situacao: string;
  setor: string;
  data: string;
  obs: string;
  usuario: string;
}

const emptyForm = (): HistoryFormState => ({
  situacao: "",
  setor: "",
  data: "",
  obs: "",
  usuario: "",
});

const FROZEN_SITUACOES = new Set(["Entregue", "Cancelada", "Cancelado"]);

const SHOW_COMPONENTE_ESPECIFICO = false;

function isEntregueSituacao(situacao: string): boolean {
  return situacao.trim() === "Entregue";
}

export function formatUsuarioPontoLabel(
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

type AndamentoTargetKey = "" | "main" | `sub:${number}` | `comp:${number}`;

interface DestinationOption {
  key: AndamentoTargetKey;
  label: string;
}

export function isOsFrozen(row: OsSearchRow | null): boolean {
  if (!row) return false;
  if (row.is_sub_os) return Boolean(row.congelada);
  return FROZEN_SITUACOES.has((row.situacao ?? "").trim());
}

function formFromHistory(row: OsHistoryRow): HistoryFormState {
  return {
    situacao: row.SituacaoLink ?? "",
    setor: row.SetorLink ?? "",
    data: formatDateBr(row.Data),
    obs: row.Observaçao ?? "",
    usuario: formatUsuarioPontoLabel(row.Ponto, row.usuario_nome),
  };
}

function formFromSubHistory(row: SubOsHistoryRow): HistoryFormState {
  return {
    situacao: row.situacao ?? "",
    setor: row.setor ?? "",
    data: formatDateBr(row.data ?? undefined),
    obs: row.observacao ?? "",
    usuario: formatUsuarioPontoLabel(row.ponto, row.usuario_nome),
  };
}

export type OsAndamentoEditorProps = {
  selected: OsSearchRow | null;
  historyRow: OsHistoryRow | null;
  subHistoryRow?: SubOsHistoryRow | null;
  /** Seleção múltipla da home; quando omitida, exclusão usa só `historyRow`. */
  selectedHistoryRows?: OsHistoryRow[];
  selectedSubHistoryRows?: SubOsHistoryRow[];
  /** Lista completa (ordem cronológica) para excluir do mais novo ao mais antigo. */
  historyListRows?: OsHistoryRow[];
  subHistoryListRows?: SubOsHistoryRow[];
  onHistoryRowChange?: (row: OsHistoryRow | null) => void;
  onSubHistoryRowChange?: (row: SubOsHistoryRow | null) => void;
  onSelectedHistoryRowsChange?: (rows: OsHistoryRow[]) => void;
  onSelectedSubHistoryRowsChange?: (rows: SubOsHistoryRow[]) => void;
  compact?: boolean;
  /** `panel` mostra o formulário sempre. `inline` só ao criar ou editar. */
  presentation?: "panel" | "inline";
  extraActions?: ReactNode;
  onEditingChange?: (editing: boolean) => void;
  onTourSavedChange?: (saved: boolean) => void;
  onSavingChange?: (saving: boolean) => void;
  /** Linha de ações (Excluir, Novo, Editar ou Salvar, Cancelar). */
  actionsRef?: Ref<HTMLDivElement>;
};

export function OsAndamentoEditor({
  selected,
  historyRow,
  subHistoryRow = null,
  selectedHistoryRows,
  selectedSubHistoryRows,
  historyListRows,
  subHistoryListRows,
  onHistoryRowChange,
  onSubHistoryRowChange,
  onSelectedHistoryRowsChange,
  onSelectedSubHistoryRowsChange,
  compact = false,
  presentation = "panel",
  extraActions,
  onEditingChange,
  onTourSavedChange,
  onSavingChange,
  actionsRef,
}: OsAndamentoEditorProps) {
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
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

  const subOsListQuery = useSubOsList(ano, id, Boolean(selected));
  const componentesQuery = useOsComponentes(ano, id, {
    enabled: Boolean(selected) && !isSubOs,
  });
  const {
    addMutation,
    updateMutation,
    deleteMutation,
    deleteManyMutation,
    replicateMutation,
  } = useOsHistoryMutations(isSubOs ? null : ano, isSubOs ? null : id);
  const {
    addMutation: addSubOsMutation,
    deleteMutation: deleteSubOsMutation,
    deleteManyMutation: deleteManySubOsMutation,
  } =
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

  const needsDestinationSelector = !isSubOs && activeComponents.length > 1;

  const situacoesQuery = useSituacoesLookup();
  const setoresQuery = useSetoresLookup();

  const [editing, setEditing] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
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
  const [entregaModalOpen, setEntregaModalOpen] = useState(false);
  const [gravacaoPendenteModalOpen, setGravacaoPendenteModalOpen] = useState(false);
  const [unirModalOpen, setUnirModalOpen] = useState(false);
  const [pendingUnirPayload, setPendingUnirPayload] = useState<HistoryPayload | null>(
    null,
  );

  const obsTextareaRef = useRef<HTMLTextAreaElement>(null);
  const pendingObsCursorRef = useRef<number | null>(null);
  const historyKey = historyRow?.CodStatus ?? "";
  const subHistoryKey = subHistoryRow?.id ?? "";

  const setEditingState = useCallback(
    (next: boolean) => {
      setEditing(next);
      onEditingChange?.(next);
    },
    [onEditingChange],
  );

  const setTourSaved = useCallback(
    (saved: boolean) => {
      onTourSavedChange?.(saved);
    },
    [onTourSavedChange],
  );

  useEffect(() => {
    return () => {
      onEditingChange?.(false);
    };
  }, [onEditingChange]);

  const resetForm = useCallback(() => {
    void lock.release();
    setEditingState(false);
    setIsEditMode(false);
    setForm(emptyForm());
  }, [lock.release, setEditingState]);

  useEffect(() => {
    resetForm();
    setAndamentoTarget(
      isSubOs && subOsId != null ? (`sub:${subOsId}` as AndamentoTargetKey) : "",
    );
    setComponenteEspecifico(false);
  }, [ano, id, isSubOs, subOsId, resetForm]);

  useEffect(() => {
    if (editing) {
      return;
    }
    if (isSubOs && subHistoryRow) {
      setForm(formFromSubHistory(subHistoryRow));
      return;
    }
    if (historyRow) {
      setForm(formFromHistory(historyRow));
      return;
    }
    setForm(emptyForm());
  }, [editing, historyRow, historyKey, isSubOs, subHistoryRow, subHistoryKey]);

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

  const frozen = isOsFrozen(selected);

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
      toast.warning("OS congelada (Entregue/Cancelada) — andamento bloqueado.");
      return;
    }
    const ok = await lock.acquire();
    if (!ok) return;
    setIsEditMode(false);
    setEditingState(true);
    setTourSaved(false);
    onSelectedHistoryRowsChange?.([]);
    onSelectedSubHistoryRowsChange?.([]);
    onHistoryRowChange?.(null);
    onSubHistoryRowChange?.(null);
    setAndamentoTarget(
      isSubOs && subOsId != null
        ? (`sub:${subOsId}` as AndamentoTargetKey)
        : "main",
    );
    setComponenteEspecifico(false);
    setForm({
      situacao: "",
      setor: "",
      data: new Date().toLocaleDateString("pt-BR"),
      obs: "",
      usuario: user ? formatUsuarioPontoLabel(user.ponto, user.nome) : "",
    });
  };

  const startEdit = async () => {
    if (!historyRow) {
      toast.warning("Selecione um andamento na lista para editar.");
      return;
    }
    const ok = await lock.acquire();
    if (!ok) return;
    setIsEditMode(true);
    setEditingState(true);
    setTourSaved(false);
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
    setEditingState(false);
    setIsEditMode(false);
    setComponenteEspecifico(false);
    setAndamentoTarget(
      isSubOs && subOsId != null ? (`sub:${subOsId}` as AndamentoTargetKey) : "",
    );
    if (isSubOs && subHistoryRow) {
      setForm(formFromSubHistory(subHistoryRow));
    } else if (historyRow) {
      setForm(formFromHistory(historyRow));
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
      toast.warning("Selecione uma OS primeiro.");
      return;
    }
    if (frozen) {
      toast.warning("OS congelada (Entregue/Cancelada) — andamento bloqueado.");
      return;
    }
    if (!form.situacao || !form.setor) {
      toast.warning("Preencha Situação e Setor.");
      return;
    }
    if (!canSaveNew) {
      toast.warning("Selecione o componente para lançar o andamento.");
      return;
    }

    const payload = payloadOverride ?? buildPayload();
    const launchingOnMainOs =
      !isSubOs &&
      !andamentoTarget.startsWith("sub:") &&
      !andamentoTarget.startsWith("comp:");
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
            toast.warning("Edição de andamento de Sub OS não disponível nesta versão.");
            return;
          }
          if (isSubOs) {
            await addSubOsMutation.mutateAsync(payload);
          } else {
            await addSubOsHistory(ano!, id!, targetSubId, payload);
            await refreshAfterSubOsSave(targetSubId);
          }
        } else if (isEditMode && historyRow) {
          await updateMutation.mutateAsync({
            ...payload,
            cod_status: historyRow.CodStatus,
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
      toast.error(`Erro ao salvar: ${e instanceof Error ? e.message : "falha"}`);
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
      toast.warning("Selecione o componente para lançar o andamento.");
      setComponenteEspecifico(true);
      setAndamentoTarget("");
      return;
    }
    void saveHistory(pending);
  };

  const handleGravacaoPendenteConfirm = (result: GravacaoPendenteLaunchResult) => {
    setGravacaoPendenteModalOpen(false);
    const obsPayload = buildGravacaoPendenteObservacaoPayload(
      form.obs,
      result.obs,
    );
    void saveHistory({
      ...buildPayload(),
      setor: SETOR_GRAVACAO_PENDENTE,
      ...obsPayload,
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
      gravacao_pendente_componente: result.componente,
    });
  };

  const historyRowsForDelete = useMemo(() => {
    if (selectedHistoryRows && selectedHistoryRows.length > 0) {
      return selectedHistoryRows;
    }
    return historyRow ? [historyRow] : [];
  }, [selectedHistoryRows, historyRow]);

  const subHistoryRowsForDelete = useMemo(() => {
    if (selectedSubHistoryRows && selectedSubHistoryRows.length > 0) {
      return selectedSubHistoryRows;
    }
    return subHistoryRow ? [subHistoryRow] : [];
  }, [selectedSubHistoryRows, subHistoryRow]);

  const clearHistorySelection = useCallback(() => {
    onSelectedHistoryRowsChange?.([]);
    onHistoryRowChange?.(null);
  }, [onSelectedHistoryRowsChange, onHistoryRowChange]);

  const clearSubHistorySelection = useCallback(() => {
    onSelectedSubHistoryRowsChange?.([]);
    onSubHistoryRowChange?.(null);
  }, [onSelectedSubHistoryRowsChange, onSubHistoryRowChange]);

  const handleDelete = async () => {
    if (isSubOs) {
      const targets = subHistoryRowsForDelete;
      if (targets.length === 0) {
        toast.warning("Selecione um andamento para excluir.");
        return;
      }
      const label =
        selected?.display_label ??
        `${selected?.nr_os} [${selected?.componente_nome ?? "Componente"}]`;
      let confirmMsg = `Excluir andamento da Sub OS ${label}?`;
      if (targets.length > 1) {
        confirmMsg = `Excluir ${targets.length} andamentos da Sub OS ${label}?\n\nEssa ação não pode ser desfeita.`;
      } else if (targets[0]?.herdado_da_os_principal) {
        confirmMsg = `Excluir andamento herdado da Sub OS ${label}?\n\nIsso remove apenas o status herdado deste componente. O andamento da OS principal não será alterado.`;
      }
      if (!window.confirm(confirmMsg)) {
        return;
      }
      const ids = sortHistoryRowsNewestFirst(
        targets,
        subHistoryListRows ?? targets,
        (row) => String(row.id),
      ).map((row) => row.id);
      try {
        if (ids.length === 1) {
          await deleteSubOsMutation.mutateAsync(ids[0]!);
          toast.success("Andamento da Sub OS excluído.");
        } else {
          await deleteManySubOsMutation.mutateAsync(ids);
          toast.success(`${ids.length} andamentos da Sub OS excluídos.`);
        }
        clearSubHistorySelection();
        setForm(emptyForm());
      } catch (e) {
        const deleted =
          e && typeof e === "object" && "deleted" in e
            ? Number((e as { deleted?: number }).deleted ?? 0)
            : 0;
        if (deleted > 0) {
          clearSubHistorySelection();
          setForm(emptyForm());
        }
        toast.error(
          deleted > 0
            ? `Erro após excluir ${deleted} de ${ids.length}: ${e instanceof Error ? e.message : "falha"}`
            : `Erro ao excluir: ${e instanceof Error ? e.message : "falha"}`,
        );
      }
      return;
    }

    const targets = historyRowsForDelete;
    if (targets.length === 0) {
      toast.error("Selecione um andamento para excluir.");
      return;
    }
    const confirmMsg =
      targets.length > 1
        ? `Confirma a exclusão de ${targets.length} andamentos?\n\nEssa ação não pode ser desfeita.`
        : "Confirma a exclusão deste andamento?\n\nEssa ação não pode ser desfeita.";
    if (!window.confirm(confirmMsg)) {
      return;
    }
    const orderedIds = sortHistoryRowsNewestFirst(
      targets,
      historyListRows ?? targets,
      (row) => row.CodStatus,
    ).map((row) => row.CodStatus);
    try {
      if (orderedIds.length === 1) {
        await deleteMutation.mutateAsync(orderedIds[0]!);
        toast.success("Andamento excluído e lista reorganizada.");
      } else {
        await deleteManyMutation.mutateAsync(orderedIds);
        toast.success(
          `${orderedIds.length} andamentos excluídos e lista reorganizada.`,
        );
      }
      clearHistorySelection();
      setForm(emptyForm());
    } catch (e) {
      const deleted =
        e && typeof e === "object" && "deleted" in e
          ? Number((e as { deleted?: number }).deleted ?? 0)
          : 0;
      if (deleted > 0) {
        clearHistorySelection();
        setForm(emptyForm());
      }
      toast.error(
        deleted > 0
          ? `Erro após excluir ${deleted} de ${orderedIds.length}: ${e instanceof Error ? e.message : "falha"}`
          : `Erro ao excluir: ${e instanceof Error ? e.message : "falha"}`,
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
        toast.warning(
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
          toast.success(
            "Andamento salvo apenas nesta OS. O criador do vínculo foi notificado.",
          );
        } else {
          toast.success("Andamento salvo apenas nesta OS.");
        }
      }
      setTourSaved(true);
      resetForm();
    } catch (e) {
      toast.error(`Erro ao aplicar decisão: ${e instanceof Error ? e.message : "falha"}`);
    }
  };

  const saving =
    addMutation.isPending ||
    updateMutation.isPending ||
    deleteMutation.isPending ||
    deleteManyMutation.isPending ||
    replicateMutation.isPending ||
    addSubOsMutation.isPending ||
    deleteSubOsMutation.isPending ||
    deleteManySubOsMutation.isPending;

  useEffect(() => {
    onSavingChange?.(saving);
  }, [onSavingChange, saving]);

  const showForm = presentation === "panel" || editing;
  const inline = presentation === "inline";

  return (
    <div className={inline ? "contents" : "flex min-h-0 min-w-0 flex-1 flex-col"}>
      <div
        className={cn(
          "flex min-w-0 flex-col",
          inline ? "w-full min-w-0 max-w-full gap-2" : "min-h-0 flex-1 overflow-hidden p-2",
        )}
      >
        {showForm ? (
          <div
            className={cn(
              "flex min-w-0 flex-col",
              inline ? "" : "min-h-0 flex-1 overflow-y-auto overscroll-contain",
            )}
          >
            <div className="flex min-h-full flex-col gap-2">
              {editing && frozen ? (
                <p className="shrink-0 text-xs font-semibold text-amber-800">
                  OS congelada — não é permitido novo andamento.
                </p>
              ) : null}

              <div
                className={cn(
                  "grid shrink-0 gap-1.5",
                  compact
                    ? "grid-cols-2"
                    : "grid-cols-1 sm:grid-cols-3 portrait:sm:grid-cols-2",
                )}
              >
                <label
                  className="min-w-0 text-xs"
                  data-tour="os-history-situacao"
                  data-testid={homeTestIds.osHistorySituacao}
                >
                  <span className="font-semibold text-neutral-600">Andamento</span>
                  <select
                    value={form.situacao}
                    disabled={!editing}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, situacao: e.target.value }))
                    }
                    className="mt-0.5 h-8 w-full rounded border border-sagra-border bg-white px-1 text-xs disabled:bg-slate-50"
                  >
                    <option value="">Selecione...</option>
                    {(situacoesQuery.data ?? []).map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </label>
                <label
                  className="min-w-0 text-xs"
                  data-tour="os-history-setor"
                  data-testid={homeTestIds.osHistorySetor}
                >
                  <span className="font-semibold text-neutral-600">Setor</span>
                  <select
                    value={form.setor}
                    disabled={!editing}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, setor: e.target.value }))
                    }
                    className="mt-0.5 h-8 w-full rounded border border-sagra-border bg-white px-1 text-xs disabled:bg-slate-50"
                  >
                    <option value="">Selecione...</option>
                    {(setoresQuery.data ?? []).map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </label>
                {compact ? (
                  <label className="min-w-0 text-xs" data-testid={homeTestIds.osHistoryData}>
                    <span className="font-semibold text-neutral-600">Data</span>
                    <input
                      type="text"
                      value={form.data}
                      readOnly
                      disabled
                      className="mt-0.5 h-8 w-full rounded border border-sagra-border bg-slate-50 px-2 text-xs tabular-nums"
                    />
                  </label>
                ) : null}
                <label
                  className={cn(
                    "min-w-0 text-xs",
                    !compact && "portrait:sm:col-span-2",
                  )}
                  data-tour="os-history-ponto"
                  data-testid={homeTestIds.osHistoryPonto}
                >
                  <span className="font-semibold text-neutral-600">Ponto</span>
                  <input
                    type="text"
                    value={form.usuario}
                    disabled={!editing}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, usuario: e.target.value }))
                    }
                    className="mt-0.5 h-8 w-full rounded border border-sagra-border bg-white px-2 text-xs disabled:bg-slate-50"
                  />
                </label>
              </div>

              {SHOW_COMPONENTE_ESPECIFICO &&
              editing &&
              !isEditMode &&
              needsDestinationSelector ? (
                <div
                  className="flex min-w-0 shrink-0 flex-col gap-1.5"
                  data-tour="os-history-componente"
                  data-testid={homeTestIds.osHistoryComponente}
                >
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
                          setAndamentoTarget(e.target.value as AndamentoTargetKey);
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
                  <span className="font-semibold text-neutral-600">Observação</span>
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
                  className="mt-0.5 min-h-[5rem] w-full flex-1 resize-none rounded border border-sagra-border bg-white px-2 py-1.5 text-xs disabled:bg-slate-50"
                />
              </div>
            </div>
          </div>
        ) : null}

        <div
          ref={actionsRef}
          className={cn(
            "flex w-full min-w-0 shrink-0 flex-wrap items-center justify-between gap-2",
            inline ? "" : "border-t border-sagra-border/60 pt-2",
          )}
        >
          {!(editing && !isEditMode) ? (
            <button
              type="button"
              title={
                (isSubOs
                  ? subHistoryRowsForDelete.length
                  : historyRowsForDelete.length) > 1
                  ? "Excluir andamentos selecionados"
                  : "Excluir andamento selecionado"
              }
              disabled={
                saving ||
                (isSubOs
                  ? subHistoryRowsForDelete.length === 0
                  : historyRowsForDelete.length === 0)
              }
              onClick={() => void handleDelete()}
              className="sagra-btn sagra-btn--delete sagra-btn--icon"
              data-testid={homeTestIds.osHistoryExcluir}
            >
              <Trash2 className="size-4" />
            </button>
          ) : (
            <span className="size-8" aria-hidden />
          )}

          <div className="flex min-w-0 max-w-full flex-wrap justify-end gap-2">
            {!editing ? extraActions : null}
            {!editing ? (
              <>
                <button
                  type="button"
                  disabled={frozen || lock.acquiring}
                  onClick={() => void startNew()}
                  data-tour="os-history-novo"
                  data-testid={homeTestIds.osHistoryNovo}
                  className="sagra-btn sagra-btn--add sagra-btn--sm"
                >
                  Novo
                </button>
                {!isSubOs ? (
                  <button
                    type="button"
                    onClick={() => void startEdit()}
                    disabled={lock.acquiring || !historyRow}
                    className="sagra-btn sagra-btn--edit sagra-btn--sm"
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
                  className="sagra-btn sagra-btn--save sagra-btn--sm"
                >
                  Salvar
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={cancelEdit}
                  className="sagra-btn sagra-btn--cancel sagra-btn--sm"
                  data-testid={homeTestIds.osHistoryCancelar}
                >
                  Cancelar
                </button>
              </>
            )}
          </div>
        </div>
      </div>

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
          selected ? { numero: selected.nr_os, ano: selected.ano } : null
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
        initialObs=""
        saving={saving}
        onClose={() => setGravacaoPendenteModalOpen(false)}
        onConfirm={handleGravacaoPendenteConfirm}
      />
    </div>
  );
}
