import { cn } from "@sagra/ui";
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronDown,
  ChevronRight as ChevronRightIcon,
  FileSpreadsheet,
  Loader2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";

import { fetchSubOsList } from "@/api/os";
import { formatDateBr } from "@/lib/format";
import { homeTestIds } from "@/lib/testId";
import {
  buildDisplayRows,
  displayRowId,
  isSameOsSelection,
  normalizeOsSelection,
  osRowKey,
} from "../osTableRows";
import type { OsSearchMeta, OsSearchRow, OsSortColumn, OsSortDir, SubOsRow } from "../types";
import { OsRowContextMenu } from "./OsContextMenu";

const ROW_HEIGHT = 36;
const MOBILE_CARD_HEIGHT = 120;

function prioClass(prioridade: string | null | undefined): string {
  if (!prioridade) {
    return "";
  }
  if (prioridade.includes("Solicitado")) {
    return "rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-900";
  }
  if (prioridade.includes("Prometido")) {
    return "rounded bg-red-100 px-1.5 py-0.5 text-xs text-red-900";
  }
  return "";
}

function buildColumns(
  hasSubOsMap: ReadonlyMap<string, boolean>,
  expanded: ReadonlySet<string>,
  onToggleExpand: (row: OsSearchRow) => void,
): ColumnDef<OsSearchRow>[] {
  return [
  {
    accessorKey: "nr_os",
    header: "Nr OS",
    size: 64,
    cell: ({ row, getValue }) => {
      const data = row.original;
      if (data.is_sub_os || data.kind === "sub_os") {
        return (
          <span className="font-medium text-secondary-blue">
            {data.display_label ?? `${data.nr_os}`}
          </span>
        );
      }
      const key = osRowKey(data);
      const hasSub = hasSubOsMap.get(key);
      const isExpanded = expanded.has(key);
      return (
        <span className="inline-flex items-center gap-1 font-medium tabular-nums">
          {hasSub ? (
            <button
              type="button"
              title={isExpanded ? "Recolher Sub OS" : "Expandir Sub OS"}
              className="rounded p-0.5 text-secondary-blue hover:bg-slate-100"
              data-testid={homeTestIds.osTableExpand(data.ano, data.nr_os)}
              onClick={(e) => {
                e.stopPropagation();
                onToggleExpand(data);
              }}
            >
              {isExpanded ? (
                <ChevronDown className="size-3.5" />
              ) : (
                <ChevronRightIcon className="size-3.5" />
              )}
            </button>
          ) : null}
          <span>
            {getValue<number>()}
            {hasSub ? " +" : ""}
          </span>
        </span>
      );
    },
  },
  {
    accessorKey: "ano",
    header: "Ano",
    size: 48,
    cell: ({ getValue }) => (
      <span className="tabular-nums">{getValue<number>()}</span>
    ),
  },
  {
    accessorKey: "data_entrada",
    header: "Entrada",
    size: 76,
    cell: ({ getValue }) => (
      <span className="tabular-nums">
        {formatDateBr(getValue<string | null>() ?? undefined)}
      </span>
    ),
  },
  {
    accessorKey: "produto",
    header: "Produto",
    size: 118,
    cell: ({ getValue }) => (
      <span className="block truncate" title={String(getValue() ?? "")}>
        {getValue<string | null>() ?? ""}
      </span>
    ),
  },
  {
    accessorKey: "solicitante",
    header: "Solicitante",
    size: 200,
    cell: ({ getValue }) => (
      <span className="block truncate" title={String(getValue() ?? "")}>
        {getValue<string | null>() ?? ""}
      </span>
    ),
  },
  {
    accessorKey: "titulo",
    header: "Título",
    size: 360,
    cell: ({ getValue }) => (
      <span className="block truncate" title={String(getValue() ?? "")}>
        {getValue<string | null>() ?? ""}
      </span>
    ),
  },
  {
    accessorKey: "situacao",
    header: "Situação",
    size: 102,
    cell: ({ row, getValue }) => {
      const v = getValue<string | null>();
      if ((row.original.is_sub_os || row.original.kind === "sub_os") && !v) {
        return <span className="text-neutral-400">—</span>;
      }
      return v ?? "";
    },
  },
  {
    accessorKey: "setor",
    header: "Setor",
    size: 58,
    cell: ({ row, getValue }) => {
      const v = getValue<string | null>();
      if ((row.original.is_sub_os || row.original.kind === "sub_os") && !v) {
        return <span className="text-neutral-400">—</span>;
      }
      return v ?? "";
    },
  },
  {
    accessorKey: "prioridade",
    header: "Prioridade",
    size: 104,
    cell: ({ getValue }) => {
      const v = getValue<string | null>();
      return <span className={prioClass(v)}>{v ?? ""}</span>;
    },
  },
  {
    accessorKey: "data_entrega",
    header: "Data",
    size: 76,
    cell: ({ getValue }) => formatDateBr(getValue<string | null>() ?? undefined),
  },
];
}

interface OsOrdersTableProps {
  rows: OsSearchRow[];
  meta: OsSearchMeta | undefined;
  isLoading: boolean;
  /** Refetch em andamento (filtro, atualizar). */
  isFetching?: boolean;
  isError: boolean;
  errorMessage?: string;
  selectedRow: OsSearchRow | null;
  onSelectRow: (row: OsSearchRow | null) => void;
  /** Bloqueia seleção/expansão durante criação/edição de andamento. */
  selectionLocked?: boolean;
  sortBy?: OsSortColumn;
  sortDir?: OsSortDir;
  onSortChange: (sortBy?: OsSortColumn, sortDir?: OsSortDir) => void;
  onExportReport?: () => void;
  isExporting?: boolean;
  exportDisabled?: boolean;
  /** Duplo clique na linha abre o modal de detalhes da gerência. */
  onOpenGerenciaDetail?: (row: OsSearchRow) => void;
}

export function OsOrdersTable({
  rows,
  meta,
  isLoading,
  isFetching = false,
  isError,
  errorMessage,
  selectedRow,
  onSelectRow,
  selectionLocked = false,
  sortBy,
  sortDir,
  onSortChange,
  onExportReport,
  isExporting = false,
  exportDisabled = false,
  onOpenGerenciaDetail,
}: OsOrdersTableProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const [, startSelectionTransition] = useTransition();
  const [expandedOs, setExpandedOs] = useState<Set<string>>(() => new Set());
  const [subOsCache, setSubOsCache] = useState<Map<string, SubOsRow[]>>(
    () => new Map(),
  );
  const [hasSubOsMap, setHasSubOsMap] = useState<Map<string, boolean>>(
    () => new Map(),
  );

  useEffect(() => {
    const next = new Map<string, boolean>();
    for (const row of rows) {
      if (row.is_sub_os || row.kind === "sub_os") continue;
      const key = osRowKey(row);
      next.set(
        key,
        Boolean(row.has_sub_os ?? (row.sub_os_count ?? 0) > 0),
      );
    }
    setHasSubOsMap(next);
  }, [rows]);

  useEffect(() => {
    const toExpand = rows.filter(
      (row) => row.matched_via_sub_os && !row.is_sub_os,
    );
    if (toExpand.length === 0) {
      return;
    }
    let cancelled = false;
    void (async () => {
      const keysToAdd = toExpand.map((row) => osRowKey(row));
      setExpandedOs((prev) => {
        const next = new Set(prev);
        for (const key of keysToAdd) {
          next.add(key);
        }
        return next;
      });
      const updates = new Map<string, SubOsRow[]>();
      for (const row of toExpand) {
        const key = osRowKey(row);
        try {
          const subs = await fetchSubOsList(row.ano, row.nr_os);
          if (!cancelled) {
            updates.set(key, subs);
          }
        } catch {
          /* ignore */
        }
      }
      if (!cancelled && updates.size > 0) {
        setSubOsCache((prev) => {
          const next = new Map(prev);
          for (const [key, subs] of updates) {
            next.set(key, subs);
          }
          return next;
        });
        setExpandedOs((prev) => {
          const next = new Set(prev);
          for (const [key, subs] of updates) {
            if (subs.length === 0) {
              next.delete(key);
            }
          }
          return next;
        });
        setHasSubOsMap((prev) => {
          const next = new Map(prev);
          for (const [key, subs] of updates) {
            if (subs.length === 0) {
              next.set(key, false);
            }
          }
          return next;
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [rows]);

  const toggleExpand = useCallback(async (row: OsSearchRow) => {
    if (selectionLocked) {
      return;
    }
    const key = osRowKey(row);
    let opening = false;
    setExpandedOs((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
        opening = true;
      }
      return next;
    });
    if (!opening) {
      return;
    }
    try {
      const subs = await fetchSubOsList(row.ano, row.nr_os);
      setSubOsCache((prev) => new Map(prev).set(key, subs));
      if (subs.length === 0) {
        setExpandedOs((prev) => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
      }
    } catch {
      setHasSubOsMap((prev) => new Map(prev).set(key, false));
    }
  }, [selectionLocked]);

  const handleSelectRow = useCallback(
    (row: OsSearchRow | null) => {
      if (selectionLocked) {
        return;
      }
      startSelectionTransition(() => {
        onSelectRow(row ? normalizeOsSelection(row) : null);
      });
    },
    [onSelectRow, selectionLocked],
  );

  const handleOpenGerenciaDetail = useCallback(
    (row: OsSearchRow) => {
      if (selectionLocked || !onOpenGerenciaDetail) {
        return;
      }
      onOpenGerenciaDetail(row);
    },
    [onOpenGerenciaDetail, selectionLocked],
  );

  const rowsRefreshSignature = useMemo(
    () =>
      rows
        .map(
          (row) =>
            `${row.ano}-${row.nr_os}-${row.situacao ?? ""}-${row.last_update ?? ""}-${row.has_sub_os ?? ""}`,
        )
        .join("|"),
    [rows],
  );

  const expandedOsRef = useRef(expandedOs);
  expandedOsRef.current = expandedOs;

  /** Atualiza Sub OS expandidas após refetch da lista (WS), sem bloquear cliques. */
  useEffect(() => {
    if (expandedOsRef.current.size === 0) {
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        const updates = new Map<string, SubOsRow[]>();
        for (const key of expandedOsRef.current) {
          const [anoStr, nroStr] = key.split("-");
          const ano = Number(anoStr);
          const nro = Number(nroStr);
          if (!Number.isFinite(ano) || !Number.isFinite(nro)) {
            continue;
          }
          try {
            const subs = await fetchSubOsList(ano, nro);
            if (!cancelled) {
              updates.set(key, subs);
            }
          } catch {
            /* mantém cache anterior */
          }
        }
        if (!cancelled && updates.size > 0) {
          setSubOsCache((prev) => {
            const next = new Map(prev);
            for (const [key, subs] of updates) {
              next.set(key, subs);
            }
            return next;
          });
        }
      })();
    }, 900);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [rowsRefreshSignature]);

  const displayRows = useMemo(
    () => buildDisplayRows(rows, expandedOs, subOsCache),
    [rows, expandedOs, subOsCache],
  );

  const columns = useMemo(
    () => buildColumns(hasSubOsMap, expandedOs, toggleExpand),
    [hasSubOsMap, expandedOs, toggleExpand],
  );

  const sorting: SortingState = useMemo(
    () => (sortBy ? [{ id: sortBy, desc: sortDir === "desc" }] : []),
    [sortBy, sortDir],
  );

  const table = useReactTable({
    data: displayRows,
    columns,
    state: { sorting },
    manualSorting: true,
    onSortingChange: (updater) => {
      const next =
        typeof updater === "function" ? updater(sorting) : updater;
      if (next.length === 0) {
        onSortChange(undefined, undefined);
        return;
      }
      const col = next[0];
      if (!col) {
        onSortChange(undefined, undefined);
        return;
      }
      const id = col.id as OsSortColumn;
      onSortChange(id, col.desc ? "desc" : "asc");
    },
    getCoreRowModel: getCoreRowModel(),
    getRowId: (row) => displayRowId(row),
  });

  const { rows: tableRows } = table.getRowModel();

  const virtualizer = useVirtualizer({
    count: tableRows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
  });

  const mobileVirtualizer = useVirtualizer({
    count: tableRows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => MOBILE_CARD_HEIGHT,
    overscan: 6,
  });

  const totalRecords = meta?.total_records;
  const isUpdating = isLoading || isFetching;
  const showLoadingOverlay = isFetching && rows.length > 0;
  const lastSearchKey = rows.length > 0 ? osRowKey(rows[rows.length - 1]!) : "";

  const headerGroups = table.getHeaderGroups();

  const countLabel = useMemo(() => {
    if (isUpdating) {
      return rows.length === 0 ? "Carregando..." : "Atualizando...";
    }
    if (rows.length === 0) {
      return "Nenhuma OP encontrada";
    }
    const total = totalRecords ?? rows.length;
    return `${total} OPs`;
  }, [isUpdating, rows.length, totalRecords]);

  useEffect(() => {
    if (isLoading || isFetching || rows.length === 0) {
      return;
    }
    const list = parentRef.current;
    if (!list) {
      return;
    }
    const frame = requestAnimationFrame(() => {
      list.scrollTop = list.scrollHeight;
    });
    return () => cancelAnimationFrame(frame);
  }, [isFetching, isLoading, lastSearchKey, rows.length]);

  return (
    <section
      data-tour="os-table"
      data-testid={homeTestIds.osTable}
      className="flex h-full min-h-0 flex-col rounded-lg border border-sagra-border bg-white shadow-sm"
      aria-busy={isUpdating}
    >
      <div
        ref={parentRef}
        className={cn(
          "relative min-h-0 flex-1 overflow-auto",
          selectionLocked && "cursor-not-allowed",
        )}
      >
        {selectionLocked ? (
          <div
            className="absolute inset-0 z-30 cursor-not-allowed bg-white/30"
            aria-hidden
          />
        ) : null}
        {showLoadingOverlay ? (
          <div
            className="absolute inset-0 z-20 flex items-start justify-center bg-white/65 pt-14"
            role="status"
            aria-live="polite"
            aria-label="Atualizando lista de OPs"
          >
            <div className="flex items-center gap-2 rounded-md border border-sagra-border bg-white px-3 py-2 shadow-sm">
              <Loader2 className="size-4 animate-spin text-secondary-blue" aria-hidden />
              <span className="text-sm font-medium text-neutral-700">
                Atualizando lista...
              </span>
            </div>
          </div>
        ) : null}
        {/* Tabela — tablet/desktop */}
        <table className="hidden w-full min-w-[980px] table-fixed border-collapse text-sm md:table">
          <thead className="sticky top-0 z-10 bg-secondary-blue text-white">
            {headerGroups.map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((header) => {
                  const sorted = header.column.getIsSorted();
                  return (
                    <th
                      key={header.id}
                      className="cursor-pointer select-none whitespace-nowrap px-2 py-2 text-left text-xs font-semibold"
                      style={{ width: header.column.getSize() }}
                      onClick={header.column.getToggleSortingHandler()}
                      data-testid={homeTestIds.osTableSort(header.id)}
                    >
                      <span className="inline-flex items-center gap-1">
                        {flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )}
                        {sorted === "asc" ? (
                          <ArrowUp className="size-3.5" />
                        ) : sorted === "desc" ? (
                          <ArrowDown className="size-3.5" />
                        ) : (
                          <ArrowUpDown className="size-3.5 opacity-50" />
                        )}
                      </span>
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {isError && (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-4 py-8 text-center text-sagra-danger"
                >
                  {errorMessage ?? "Erro ao carregar ordens de serviço."}
                </td>
              </tr>
            )}
            {!isError && isLoading && rows.length === 0 && (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-4 py-8 text-center text-neutral-500"
                >
                  Carregando...
                </td>
              </tr>
            )}
            {!isError && !isLoading && rows.length === 0 && (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-4 py-8 text-center text-neutral-500"
                >
                  Nenhum registro encontrado.
                </td>
              </tr>
            )}
            {!isError && tableRows.length > 0 && (
              <>
                {virtualizer.getVirtualItems().length > 0 && (
                  <tr style={{ height: virtualizer.getVirtualItems()[0]?.start ?? 0 }}>
                    <td colSpan={columns.length} />
                  </tr>
                )}
                {virtualizer.getVirtualItems().map((virtualRow) => {
                  const tableRow = tableRows[virtualRow.index];
                  if (!tableRow) {
                    return null;
                  }
                  const data = tableRow.original;
                  const isSelected = isSameOsSelection(selectedRow, data);

                  return (
                    <OsRowContextMenu
                      key={displayRowId(data)}
                      row={data}
                      onSelectRow={onSelectRow}
                    >
                      <tr
                        data-index={virtualRow.index}
                        data-testid={homeTestIds.osTableRow(data.ano, data.nr_os)}
                        style={{ height: ROW_HEIGHT }}
                        className={cn(
                          "border-b border-sagra-border/60",
                          selectionLocked
                            ? "cursor-not-allowed"
                            : "cursor-pointer hover:bg-slate-50",
                          (data.is_sub_os || data.kind === "sub_os") && "bg-slate-50/70",
                          isSelected && "bg-[var(--highlight-yellow)]",
                        )}
                        onClick={() => handleSelectRow(data)}
                        onDoubleClick={() => handleOpenGerenciaDetail(data)}
                        onContextMenu={() => handleSelectRow(data)}
                      >
                        {tableRow.getVisibleCells().map((cell) => (
                          <td
                            key={cell.id}
                            className="px-2 py-1 align-middle"
                            style={{ width: cell.column.getSize() }}
                          >
                            {flexRender(
                              cell.column.columnDef.cell,
                              cell.getContext(),
                            )}
                          </td>
                        ))}
                      </tr>
                    </OsRowContextMenu>
                  );
                })}
                {virtualizer.getVirtualItems().length > 0 && (
                  <tr
                    style={{
                      height:
                        virtualizer.getTotalSize() -
                        (virtualizer.getVirtualItems().at(-1)?.end ?? 0),
                    }}
                  >
                    <td colSpan={columns.length} />
                  </tr>
                )}
              </>
            )}
          </tbody>
        </table>

        {/* Cards — mobile */}
        <div className="md:hidden">
          {isError ? (
            <p className="px-4 py-8 text-center text-sagra-danger">
              {errorMessage ?? "Erro ao carregar ordens de serviço."}
            </p>
          ) : null}
          {!isError && isUpdating && rows.length === 0 ? (
            <p className="px-4 py-8 text-center text-neutral-500">Carregando...</p>
          ) : null}
          {!isError && !isUpdating && rows.length === 0 ? (
            <p className="px-4 py-8 text-center text-neutral-500">
              Nenhum registro encontrado.
            </p>
          ) : null}
          {!isError && tableRows.length > 0 ? (
            <div className="relative w-full">
              {mobileVirtualizer.getVirtualItems().length > 0 ? (
                <div
                  style={{ height: mobileVirtualizer.getVirtualItems()[0]?.start ?? 0 }}
                  aria-hidden
                />
              ) : null}
              {mobileVirtualizer.getVirtualItems().map((virtualRow) => {
                const tableRow = tableRows[virtualRow.index];
                if (!tableRow) return null;
                const data = tableRow.original;
                const isSelected = isSameOsSelection(selectedRow, data);

                return (
                  <OsRowContextMenu
                    key={`mobile-${displayRowId(data)}`}
                    row={data}
                    onSelectRow={onSelectRow}
                  >
                    <button
                      type="button"
                      data-index={virtualRow.index}
                      data-testid={homeTestIds.osTableRow(data.ano, data.nr_os)}
                      style={{ height: MOBILE_CARD_HEIGHT }}
                      className={cn(
                        "flex w-full flex-col gap-1 border-b border-sagra-border/60 px-3 py-2.5 text-left",
                        selectionLocked
                          ? "cursor-not-allowed"
                          : "hover:bg-slate-50 active:bg-slate-100",
                        isSelected && "bg-[var(--highlight-yellow)]",
                      )}
                      onClick={() => handleSelectRow(data)}
                      onDoubleClick={() => handleOpenGerenciaDetail(data)}
                      onContextMenu={() => handleSelectRow(data)}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-sm font-bold tabular-nums text-secondary-blue">
                          {data.is_sub_os || data.kind === "sub_os"
                            ? (data.display_label ?? `${data.nr_os}`)
                            : `OS ${data.nr_os}/${data.ano}`}
                        </span>
                        <span className="shrink-0 text-xs tabular-nums text-neutral-500">
                          {formatDateBr(data.data_entrega ?? undefined)}
                        </span>
                      </div>
                      <p className="line-clamp-2 text-sm font-medium leading-snug text-neutral-800">
                        {data.titulo || "—"}
                      </p>
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-neutral-600">
                        {data.data_entrada ? (
                          <span className="tabular-nums">
                            Entrada {formatDateBr(data.data_entrada)}
                          </span>
                        ) : null}
                        {data.produto ? (
                          <span className="truncate">
                            {data.data_entrada ? "· " : ""}
                            {data.produto}
                          </span>
                        ) : null}
                        {data.situacao ? (
                          <span className="truncate">· {data.situacao}</span>
                        ) : null}
                        {data.setor ? <span className="truncate">· {data.setor}</span> : null}
                      </div>
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="truncate text-neutral-500">
                          {data.solicitante || "—"}
                        </span>
                        {data.prioridade ? (
                          <span className={cn("shrink-0", prioClass(data.prioridade))}>
                            {data.prioridade}
                          </span>
                        ) : null}
                      </div>
                    </button>
                  </OsRowContextMenu>
                );
              })}
              {mobileVirtualizer.getVirtualItems().length > 0 ? (
                <div
                  style={{
                    height:
                      mobileVirtualizer.getTotalSize() -
                      (mobileVirtualizer.getVirtualItems().at(-1)?.end ?? 0),
                  }}
                  aria-hidden
                />
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-sagra-border px-3 py-2 text-sm text-neutral-600">
        <span className="truncate">
          {isUpdating ? (
            <span className="inline-flex items-center gap-1.5">
              <Loader2 className="size-3.5 shrink-0 animate-spin text-secondary-blue" aria-hidden />
              {countLabel}
            </span>
          ) : (
            countLabel
          )}
        </span>
        {onExportReport ? (
          <button
            type="button"
            disabled={exportDisabled || isExporting}
            onClick={onExportReport}
            className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg bg-[#217346] px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-[#1e6b41] disabled:cursor-not-allowed disabled:opacity-60"
            data-testid={homeTestIds.osTableReport}
          >
            {isExporting ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
            ) : (
              <FileSpreadsheet className="size-3.5" aria-hidden />
            )}
            Gerar Relatório
          </button>
        ) : null}
      </div>
    </section>
  );
}
