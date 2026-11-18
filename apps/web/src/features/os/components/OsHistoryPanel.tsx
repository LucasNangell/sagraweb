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
import { dedupeOsHistoryRows } from "../osHistoryUtils";
import type { OsHistoryRow, OsSearchRow, SubOsHistoryRow } from "../types";
import { OsGravacaoAlterarArquivosButton } from "./OsGravacaoAlterarArquivosButton";
import { OsAndamentoEditor, isOsFrozen } from "./OsAndamentoEditor";

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
  const [saving, setSaving] = useState(false);
  const [tourSaved, setTourSaved] = useState(false);
  const [selectedHistory, setSelectedHistory] = useState<OsHistoryRow | null>(null);
  const [selectedSubHistory, setSelectedSubHistory] =
    useState<SubOsHistoryRow | null>(null);

  const handleEditingChange = useCallback(
    (next: boolean) => {
      setEditing(next);
      onEditingChange?.(next);
    },
    [onEditingChange],
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

  useEffect(() => {
    setSelectedHistory(null);
    setSelectedSubHistory(null);
    setTourSaved(false);
    lastAutoKeyRef.current = null;
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
      setSelectedSubHistory(last as SubOsHistoryRow);
    } else {
      setSelectedHistory(last as OsHistoryRow);
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
                "w-full min-w-0 table-fixed border-collapse text-xs",
                editing && "pointer-events-none opacity-60",
              )}
            >
              <thead className="sticky top-0 bg-slate-100">
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
                      const isRowSelected = selectedSubHistory?.id === subRow.id;
                      return (
                        <tr
                          key={`${historyOsKey}-${subRow.id}`}
                          data-testid={homeTestIds.osHistoryRow(subRow.id)}
                          onClick={() => {
                            if (!editing) {
                              setSelectedSubHistory(subRow);
                            }
                          }}
                          className={cn(
                            "cursor-pointer border-b border-sagra-border/50 hover:bg-slate-50",
                            isRowSelected && "bg-[var(--highlight-yellow)]",
                          )}
                        >
                          <td className="min-w-0 overflow-hidden px-2 py-1">
                            <span className="block truncate" title={subRow.situacao ?? undefined}>
                              {subRow.situacao ?? "-"}
                            </span>
                          </td>
                          <td
                            className="overflow-hidden px-1.5 py-1"
                            style={{ width: compactList ? "5.5rem" : "6.5rem" }}
                          >
                            <span className="block truncate" title={subRow.setor ?? undefined}>
                              {subRow.setor ?? "-"}
                            </span>
                          </td>
                          {!compactList ? (
                            <td className="overflow-hidden px-1.5 py-1 whitespace-nowrap" style={{ width: "5.75rem" }}>
                              <span className="block tabular-nums">
                                {formatDateBr(subRow.data ?? undefined)}
                              </span>
                            </td>
                          ) : null}
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
                            setSelectedHistory(mainRow);
                          }
                        }}
                        className={cn(
                          "cursor-pointer border-b border-sagra-border/50 hover:bg-slate-50",
                          isRowSelected && "bg-[var(--highlight-yellow)]",
                        )}
                      >
                        <td className="min-w-0 overflow-hidden px-2 py-1">
                          <span className="block truncate" title={mainRow.SituacaoLink ?? undefined}>
                            {mainRow.SituacaoLink ?? "-"}
                          </span>
                        </td>
                        <td
                          className="overflow-hidden px-1.5 py-1"
                          style={{ width: compactList ? "5.5rem" : "6.5rem" }}
                        >
                          <span className="block truncate" title={mainRow.SetorLink ?? undefined}>
                            {mainRow.SetorLink ?? "-"}
                          </span>
                        </td>
                        {!compactList ? (
                          <td className="overflow-hidden px-1.5 py-1 whitespace-nowrap" style={{ width: "5.75rem" }}>
                            <span className="block tabular-nums">
                              {formatDateBr(mainRow.Data)}
                            </span>
                          </td>
                        ) : null}
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          <OsAndamentoEditor
            selected={selected}
            historyRow={selectedHistory}
            subHistoryRow={selectedSubHistory}
            onHistoryRowChange={setSelectedHistory}
            onSubHistoryRowChange={setSelectedSubHistory}
            compact={compactList}
            presentation="panel"
            onEditingChange={handleEditingChange}
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
