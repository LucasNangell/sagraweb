import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { cn } from "@sagra/ui";
import { Link } from "@tanstack/react-router";
import { Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useOsHistory } from "@/api/hooks/useOsHistory";
import { useSubOsHistory } from "@/api/hooks/useSubOs";
import {
  analiseButtonCaption,
  canEditAnalisePreview,
  hasProblemasTecnicosAndamento,
  resolveAnaliseButtonMode,
} from "@/features/analise/analiseAccess";
import { useAccessControl } from "@/features/auth/useAccessControl";
import { useAuthStore } from "@/features/auth/authStore";
import { formatDateBr } from "@/lib/format";
import { homeTestIds } from "@/lib/testId";
import {
  nextHistorySelectionRows,
  resolveHistorySelectionMode,
} from "../osHistoryMultiselect";
import {
  applyOsHistoryDraftOrder,
  dedupeOsHistoryRows,
} from "../osHistoryUtils";
import type { OsHistoryRow, OsSearchRow, SubOsHistoryRow } from "../types";
import { OsGravacaoAlterarArquivosButton } from "./OsGravacaoAlterarArquivosButton";
import { OsAndamentoEditor, isOsFrozen } from "./OsAndamentoEditor";
import { OsSortableHistoryRow } from "./OsSortableHistoryRow";

interface OsHistoryPanelProps {
  selected: OsSearchRow | null;
  flash?: boolean;
  embedded?: boolean;
  /**
   * `default`: lista Situação|Setor|Data; formulário Andamento|Setor|Ponto.
   * `compact`: lista só Situação|Setor; formulário Andamento|Setor e Data|Ponto abaixo.
   */
  listLayout?: "default" | "compact";
  onEditingChange?: (editing: boolean) => void;
}

export function OsHistoryPanel({
  selected,
  flash,
  embedded = false,
  listLayout = "default",
  onEditingChange,
}: OsHistoryPanelProps) {
  const compactList = listLayout === "compact";
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

  const historyQuery = useOsHistory(osAno, osId);
  const subHistoryQuery = useSubOsHistory(ano, id, subOsId);

  const [editing, setEditing] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [draftOrder, setDraftOrder] = useState<string[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [tourSaved, setTourSaved] = useState(false);
  const [selectedHistoryRows, setSelectedHistoryRows] = useState<
    OsHistoryRow[]
  >([]);
  const [selectedSubHistoryRows, setSelectedSubHistoryRows] = useState<
    SubOsHistoryRow[]
  >([]);

  const selectedHistory =
    selectedHistoryRows.length === 1 ? selectedHistoryRows[0]! : null;
  const selectedSubHistory =
    selectedSubHistoryRows.length === 1 ? selectedSubHistoryRows[0]! : null;

  const reorderEnabled =
    !isSubOs && editing && isEditMode && selectedHistory != null;

  const handleEditingChange = useCallback(
    (next: boolean) => {
      setEditing(next);
      if (!next) {
        setIsEditMode(false);
        setDraftOrder(null);
      }
      onEditingChange?.(next);
    },
    [onEditingChange],
  );

  const handleEditModeChange = useCallback((next: boolean) => {
    setIsEditMode(next);
    if (!next) {
      setDraftOrder(null);
    }
  }, []);

  const clearDraftOrder = useCallback(() => {
    setDraftOrder(null);
  }, []);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

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
    return applyOsHistoryDraftOrder(historyQuery.data ?? [], draftOrder);
  }, [
    historyQueryEnabled,
    isSubOs,
    historyQuery.isPending,
    historyQuery.data,
    subHistoryQuery.isPending,
    subHistoryQuery.data,
    draftOrder,
  ]);

  const sortableIds = useMemo(() => {
    if (isSubOs) {
      return [];
    }
    return (rows as OsHistoryRow[]).map((row) => row.CodStatus);
  }, [isSubOs, rows]);

  const handleHistoryDragEnd = useCallback(
    (event: DragEndEvent) => {
      if (!reorderEnabled || !selectedHistory) {
        return;
      }
      const { active, over } = event;
      if (!over || active.id === over.id) {
        return;
      }
      const currentOrder =
        draftOrder ??
        (rows as OsHistoryRow[]).map((row) => row.CodStatus);
      const oldIndex = currentOrder.indexOf(String(active.id));
      const newIndex = currentOrder.indexOf(String(over.id));
      if (oldIndex < 0 || newIndex < 0) {
        return;
      }
      if (String(active.id) !== selectedHistory.CodStatus) {
        return;
      }
      setDraftOrder(arrayMove(currentOrder, oldIndex, newIndex));
    },
    [reorderEnabled, selectedHistory, draftOrder, rows],
  );

  const showHistoryLoading =
    !historyQueryEnabled ||
    (isSubOs
      ? subHistoryQuery.isPending ||
        (subHistoryQuery.isFetching && rows.length === 0)
      : historyQuery.isPending ||
        (historyQuery.isFetching && rows.length === 0));

  const frozen = isOsFrozen(selected);

  const lastAutoKeyRef = useRef<string | null>(null);
  const selectionAnchorKeyRef = useRef<string | null>(null);
  const historyListRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setSelectedHistoryRows([]);
    setSelectedSubHistoryRows([]);
    setTourSaved(false);
    setDraftOrder(null);
    lastAutoKeyRef.current = null;
    selectionAnchorKeyRef.current = null;
  }, [ano, id, isSubOs, subOsId]);

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
      const subLast = last as SubOsHistoryRow;
      setSelectedSubHistoryRows([subLast]);
      setSelectedHistoryRows([]);
      selectionAnchorKeyRef.current = String(subLast.id);
    } else {
      const mainLast = last as OsHistoryRow;
      setSelectedHistoryRows([mainLast]);
      setSelectedSubHistoryRows([]);
      selectionAnchorKeyRef.current = mainLast.CodStatus;
    }
  }, [rows, selected, editing, ano, id, isSubOs]);

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

  const analiseCaption = analiseMode ? analiseButtonCaption(analiseMode) : "";

  return (
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
          {embedded
            ? "Selecione uma SP na lista para ver o histórico."
            : "Selecione uma OS para ver o histórico."}
        </p>
      )}

      {selected && (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden sm:flex-row">
          <div
            ref={historyListRef}
            className={cn(
              "relative max-h-[min(40vh,280px)] min-h-[140px] min-w-0 shrink-0 overflow-x-hidden overflow-y-auto overscroll-contain border-b border-sagra-border sm:max-h-none sm:h-auto sm:w-[45.6%] sm:border-r sm:border-b-0",
              "portrait:sm:w-[54%]",
              editing && !reorderEnabled && "opacity-60",
            )}
          >
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleHistoryDragEnd}
            >
              <table className="w-full min-w-0 table-fixed border-collapse text-xs select-none">
                <thead className="sticky top-0 z-[1] bg-slate-100">
                  <tr>
                    <th className="min-w-0 overflow-hidden px-2 py-1.5 text-left font-semibold">
                      Situação
                    </th>
                    <th
                      className="overflow-hidden px-1.5 py-1.5 text-left font-semibold"
                      style={{ width: compactList ? "5.5rem" : "6.5rem" }}
                    >
                      Setor
                    </th>
                    {!compactList ? (
                      <th
                        className="overflow-hidden px-1.5 py-1.5 text-left font-semibold"
                        style={{ width: "5.75rem" }}
                      >
                        Data
                      </th>
                    ) : null}
                  </tr>
                </thead>
                <SortableContext
                  items={sortableIds}
                  strategy={verticalListSortingStrategy}
                >
                  <tbody key={historyOsKey ?? "empty"}>
                    {showHistoryLoading ? (
                      <tr>
                        <td
                          colSpan={compactList ? 2 : 3}
                          className="px-2 py-4 text-center text-neutral-500"
                        >
                          Carregando...
                        </td>
                      </tr>
                    ) : rows.length === 0 ? (
                      <tr>
                        <td
                          colSpan={compactList ? 2 : 3}
                          className="px-2 py-4 text-center text-neutral-500"
                        >
                          Nenhum andamento.
                        </td>
                      </tr>
                    ) : (
                      rows.map((row) => {
                        if (isSubOs) {
                          const subRow = row as SubOsHistoryRow;
                          const isRowSelected = selectedSubHistoryRows.some(
                            (item) => item.id === subRow.id,
                          );
                          return (
                            <tr
                              key={`${historyOsKey}-${subRow.id}`}
                              data-testid={homeTestIds.osHistoryRow(subRow.id)}
                              onClick={(event) => {
                                if (editing) {
                                  return;
                                }
                                const mode = resolveHistorySelectionMode(event);
                                setSelectedSubHistoryRows((current) => {
                                  const result = nextHistorySelectionRows(
                                    current,
                                    subRow,
                                    (item) => String(item.id),
                                    mode,
                                    {
                                      allRows: rows as SubOsHistoryRow[],
                                      anchorKey: selectionAnchorKeyRef.current,
                                    },
                                  );
                                  selectionAnchorKeyRef.current =
                                    result.nextAnchorKey;
                                  return result.rows;
                                });
                              }}
                              className={cn(
                                "cursor-pointer border-b border-sagra-border/50 hover:bg-slate-50",
                                isRowSelected && "bg-[var(--highlight-yellow)]",
                              )}
                            >
                              <td className="min-w-0 overflow-hidden px-2 py-1">
                                <span
                                  className="block truncate"
                                  title={subRow.situacao ?? undefined}
                                >
                                  {subRow.situacao ?? "-"}
                                </span>
                              </td>
                              <td
                                className="overflow-hidden px-1.5 py-1"
                                style={{
                                  width: compactList ? "5.5rem" : "6.5rem",
                                }}
                              >
                                <span
                                  className="block truncate"
                                  title={subRow.setor ?? undefined}
                                >
                                  {subRow.setor ?? "-"}
                                </span>
                              </td>
                              {!compactList ? (
                                <td
                                  className="overflow-hidden whitespace-nowrap px-1.5 py-1"
                                  style={{ width: "5.75rem" }}
                                >
                                  <span className="block tabular-nums">
                                    {formatDateBr(subRow.data ?? undefined)}
                                  </span>
                                </td>
                              ) : null}
                            </tr>
                          );
                        }
                        const mainRow = row as OsHistoryRow;
                        const isRowSelected = selectedHistoryRows.some(
                          (item) => item.CodStatus === mainRow.CodStatus,
                        );
                        const isEditingRow =
                          reorderEnabled &&
                          selectedHistory?.CodStatus === mainRow.CodStatus;
                        return (
                          <OsSortableHistoryRow
                            key={`${historyOsKey}-${mainRow.CodStatus}`}
                            id={mainRow.CodStatus}
                            testId={homeTestIds.osHistoryRow(mainRow.CodStatus)}
                            disabled={!isEditingRow}
                            selected={isRowSelected}
                            showDragHandle={Boolean(isEditingRow)}
                            compactList={compactList}
                            situacao={mainRow.SituacaoLink ?? ""}
                            setor={mainRow.SetorLink ?? ""}
                            onRowClick={(event) => {
                              if (editing) {
                                return;
                              }
                              const mode = resolveHistorySelectionMode(event);
                              setSelectedHistoryRows((current) => {
                                const result = nextHistorySelectionRows(
                                  current,
                                  mainRow,
                                  (item) => item.CodStatus,
                                  mode,
                                  {
                                    allRows: rows as OsHistoryRow[],
                                    anchorKey: selectionAnchorKeyRef.current,
                                  },
                                );
                                selectionAnchorKeyRef.current =
                                  result.nextAnchorKey;
                                return result.rows;
                              });
                            }}
                            dataCell={
                              <td
                                className="overflow-hidden whitespace-nowrap px-1.5 py-1"
                                style={{ width: "5.75rem" }}
                              >
                                <span className="block tabular-nums">
                                  {formatDateBr(mainRow.Data)}
                                </span>
                              </td>
                            }
                          />
                        );
                      })
                    )}
                  </tbody>
                </SortableContext>
              </table>
            </DndContext>
          </div>

          <OsAndamentoEditor
            selected={selected}
            historyRow={selectedHistory}
            subHistoryRow={selectedSubHistory}
            selectedHistoryRows={selectedHistoryRows}
            selectedSubHistoryRows={selectedSubHistoryRows}
            historyListRows={
              isSubOs
                ? undefined
                : dedupeOsHistoryRows(historyQuery.data ?? [])
            }
            subHistoryListRows={
              isSubOs ? (rows as SubOsHistoryRow[]) : undefined
            }
            draftOrder={draftOrder}
            onDraftOrderClear={clearDraftOrder}
            onHistoryRowChange={(row) => {
              setSelectedHistoryRows(row ? [row] : []);
              selectionAnchorKeyRef.current = row?.CodStatus ?? null;
            }}
            onSubHistoryRowChange={(row) => {
              setSelectedSubHistoryRows(row ? [row] : []);
              selectionAnchorKeyRef.current =
                row != null ? String(row.id) : null;
            }}
            onSelectedHistoryRowsChange={(next) => {
              setSelectedHistoryRows(next);
              if (next.length === 1) {
                selectionAnchorKeyRef.current = next[0]!.CodStatus;
              } else if (next.length === 0) {
                selectionAnchorKeyRef.current = null;
              }
            }}
            onSelectedSubHistoryRowsChange={(next) => {
              setSelectedSubHistoryRows(next);
              if (next.length === 1) {
                selectionAnchorKeyRef.current = String(next[0]!.id);
              } else if (next.length === 0) {
                selectionAnchorKeyRef.current = null;
              }
            }}
            compact={compactList}
            presentation="panel"
            onEditingChange={handleEditingChange}
            onEditModeChange={handleEditModeChange}
            onTourSavedChange={setTourSaved}
            onSavingChange={setSaving}
            extraActions={
              <>
                {showAnaliseButton ? (
                  <Link
                    to="/analise"
                    search={{
                      ano: String(osAno),
                      id: String(osId),
                    }}
                    title={analiseCaption}
                    aria-label={analiseCaption}
                    className={cn(
                      "sagra-btn sagra-btn--search sagra-btn--sm no-underline hover:no-underline",
                      "portrait:h-8 portrait:w-8 portrait:min-h-8 portrait:min-w-8 portrait:shrink-0 portrait:gap-0 portrait:p-0 portrait:rounded",
                    )}
                    data-testid={homeTestIds.osHistoryAnalise}
                  >
                    <Search className="size-3.5" aria-hidden />
                    <span className="portrait:hidden">{analiseCaption}</span>
                  </Link>
                ) : null}
                {!isSubOs ? (
                  <OsGravacaoAlterarArquivosButton
                    selected={selected}
                    frozen={frozen}
                    disabled={saving}
                  />
                ) : null}
              </>
            }
          />
        </div>
      )}
    </section>
  );
}
