import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  horizontalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { cn } from "@sagra/ui";
import {
  flexRender,
  functionalUpdate,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type ColumnOrderState,
  type ColumnSizingState,
  type Header,
  type OnChangeFn,
  type SortingState,
  type VisibilityState,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronDown,
  ChevronRight as ChevronRightIcon,
  ChevronUp,
  FileSpreadsheet,
  Loader2,
  Settings,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";

import { fetchSubOsList } from "@/api/os";
import { useAuthStore } from "@/features/auth/authStore";
import { useUserPreferenceSync } from "@/hooks/useUserPreferenceSync";
import { formatDateBr, formatDateTimeBr } from "@/lib/format";
import { homeTestIds } from "@/lib/testId";
import {
  buildDisplayRows,
  displayRowId,
  isSameOsSelection,
  normalizeOsSelection,
  osRowKey,
} from "../osTableRows";
import type { OsSearchMeta, OsSearchRow, OsSortColumn, OsSortDir, SubOsRow } from "../types";
import {
  cycleOsSortKeys,
  osSortHeaderMeta,
  resolveOsSorts,
  type OsSortKey,
} from "../osSortKeys";
import {
  OS_HOME_TABLE_COLUMN_LABELS,
  OS_HOME_TABLE_DEFAULT_WIDTHS,
  OS_HOME_TABLE_MAX_WIDTH,
  OS_HOME_TABLE_MIN_WIDTHS,
  isOsHomeTableColumnId,
  isOsHomeTableColumnSortable,
  mergeOsHomeTableLayout,
  moveOsHomeTableColumn,
  normalizeOsHomeTableVisibility,
  osHomeTableColumnPercents,
  readLocalOsHomeTableLayout,
  resizeOsHomeTableColumnPair,
  visibleOsHomeTableColumns,
  type OsHomeTableColumnId,
  type OsHomeTableLayout,
} from "../osHomeTableLayout";
import { OsRowContextMenu } from "./OsContextMenu";
import { OsListConfigModal } from "./OsListConfigModal";

const ROW_HEIGHT = 28;
const MOBILE_CARD_HEIGHT = 120;
/** Janela após resize/drag em que o click residual no header não ordena. */
const HEADER_CLICK_SUPPRESS_MS = 250;

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

function columnSizeDef(id: OsHomeTableColumnId) {
  return {
    enableSorting: isOsHomeTableColumnSortable(id),
    size: OS_HOME_TABLE_DEFAULT_WIDTHS[id],
    minSize: OS_HOME_TABLE_MIN_WIDTHS[id],
    maxSize: OS_HOME_TABLE_MAX_WIDTH,
  };
}

function textColumn(id: OsHomeTableColumnId): ColumnDef<OsSearchRow> {
  return {
    accessorKey: id,
    header: OS_HOME_TABLE_COLUMN_LABELS[id],
    ...columnSizeDef(id),
    cell: ({ getValue }) => {
      const text = String(getValue() ?? "");
      return (
        <span className="block truncate" title={text}>
          {text}
        </span>
      );
    },
  };
}

function buildColumns(
  hasSubOsMap: ReadonlyMap<string, boolean>,
  expanded: ReadonlySet<string>,
  onToggleExpand: (row: OsSearchRow) => void,
): ColumnDef<OsSearchRow>[] {
  return [
  {
    accessorKey: "nr_os",
    header: OS_HOME_TABLE_COLUMN_LABELS.nr_os,
    ...columnSizeDef("nr_os"),
    // Identidade da linha + expand de Sub OS: sempre visível.
    enableHiding: false,
    cell: ({ row, getValue }) => {
      const data = row.original;
      if (data.is_sub_os || data.kind === "sub_os") {
        const label = data.display_label ?? `${data.nr_os}`;
        return (
          <span
            className="block truncate font-medium text-secondary-blue"
            title={label}
          >
            {label}
          </span>
        );
      }
      const key = osRowKey(data);
      const hasSub = hasSubOsMap.get(key);
      const isExpanded = expanded.has(key);
      return (
        <span className="inline-flex min-w-0 max-w-full items-center gap-1 font-medium tabular-nums">
          {hasSub ? (
            <button
              type="button"
              title={isExpanded ? "Recolher Sub OS" : "Expandir Sub OS"}
              className="shrink-0 rounded p-0.5 text-secondary-blue hover:bg-slate-100"
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
          <span className="min-w-0 truncate">
            {getValue<number>()}
            {hasSub ? " +" : ""}
          </span>
        </span>
      );
    },
  },
  {
    accessorKey: "ano",
    header: OS_HOME_TABLE_COLUMN_LABELS.ano,
    ...columnSizeDef("ano"),
    cell: ({ getValue }) => (
      <span className="block truncate tabular-nums">{getValue<number>()}</span>
    ),
  },
  {
    accessorKey: "data_entrada",
    header: OS_HOME_TABLE_COLUMN_LABELS.data_entrada,
    ...columnSizeDef("data_entrada"),
    cell: ({ getValue }) => {
      const text = formatDateBr(getValue<string | null>() ?? undefined);
      return (
        <span className="block truncate tabular-nums" title={text}>
          {text}
        </span>
      );
    },
  },
  {
    accessorKey: "produto",
    header: OS_HOME_TABLE_COLUMN_LABELS.produto,
    ...columnSizeDef("produto"),
    cell: ({ getValue }) => (
      <span className="block truncate" title={String(getValue() ?? "")}>
        {getValue<string | null>() ?? ""}
      </span>
    ),
  },
  {
    accessorKey: "solicitante",
    header: OS_HOME_TABLE_COLUMN_LABELS.solicitante,
    ...columnSizeDef("solicitante"),
    cell: ({ getValue }) => (
      <span className="block truncate" title={String(getValue() ?? "")}>
        {getValue<string | null>() ?? ""}
      </span>
    ),
  },
  {
    accessorKey: "titulo",
    header: OS_HOME_TABLE_COLUMN_LABELS.titulo,
    ...columnSizeDef("titulo"),
    cell: ({ getValue }) => (
      <span className="block truncate" title={String(getValue() ?? "")}>
        {getValue<string | null>() ?? ""}
      </span>
    ),
  },
  {
    accessorKey: "situacao",
    header: OS_HOME_TABLE_COLUMN_LABELS.situacao,
    ...columnSizeDef("situacao"),
    cell: ({ row, getValue }) => {
      const v = getValue<string | null>();
      if ((row.original.is_sub_os || row.original.kind === "sub_os") && !v) {
        return <span className="text-neutral-400">—</span>;
      }
      const text = v ?? "";
      return (
        <span className="block truncate" title={text}>
          {text}
        </span>
      );
    },
  },
  {
    accessorKey: "setor",
    header: OS_HOME_TABLE_COLUMN_LABELS.setor,
    ...columnSizeDef("setor"),
    cell: ({ row, getValue }) => {
      const v = getValue<string | null>();
      if ((row.original.is_sub_os || row.original.kind === "sub_os") && !v) {
        return <span className="text-neutral-400">—</span>;
      }
      const text = v ?? "";
      return (
        <span className="block truncate" title={text}>
          {text}
        </span>
      );
    },
  },
  {
    accessorKey: "prioridade",
    header: OS_HOME_TABLE_COLUMN_LABELS.prioridade,
    ...columnSizeDef("prioridade"),
    cell: ({ getValue }) => {
      const v = getValue<string | null>();
      const text = v ?? "";
      return (
        <span className={cn("block truncate", prioClass(v))} title={text}>
          {text}
        </span>
      );
    },
  },
  {
    accessorKey: "data_entrega",
    header: OS_HOME_TABLE_COLUMN_LABELS.data_entrega,
    ...columnSizeDef("data_entrega"),
    cell: ({ getValue }) => {
      const text = formatDateBr(getValue<string | null>() ?? undefined);
      return (
        <span className="block truncate tabular-nums" title={text}>
          {text}
        </span>
      );
    },
  },
  textColumn("formato"),
  textColumn("entreg_periodo"),
  {
    accessorKey: "last_update",
    header: OS_HOME_TABLE_COLUMN_LABELS.last_update,
    ...columnSizeDef("last_update"),
    cell: ({ getValue }) => {
      const text = formatDateTimeBr(getValue<string | null>() ?? undefined);
      return (
        <span className="block truncate tabular-nums" title={text}>
          {text}
        </span>
      );
    },
  },
  textColumn("andamento_usuario"),
  textColumn("observacao"),
  {
    accessorKey: "sub_os_count",
    header: OS_HOME_TABLE_COLUMN_LABELS.sub_os_count,
    ...columnSizeDef("sub_os_count"),
    cell: ({ row, getValue }) => {
      if (row.original.is_sub_os || row.original.kind === "sub_os") {
        return <span className="text-neutral-400">—</span>;
      }
      const count = getValue<number | null | undefined>() ?? 0;
      return <span className="block truncate tabular-nums">{count > 0 ? count : ""}</span>;
    },
  },
];
}

interface SortableHeaderCellProps {
  header: Header<OsSearchRow, unknown>;
  activeSorts: OsSortKey[];
  onSortClick: (columnId: string) => void;
  /** Última coluna visível: sem handle (borda = fim da lista) e espaço para a engrenagem. */
  isLast: boolean;
  isResizing: boolean;
  onResizeStart: (columnId: string, clientX: number, th: HTMLElement | null) => void;
  /** Abre "Configurar lista" (engrenagem no fim do cabeçalho; só na última coluna). */
  onOpenConfig: () => void;
}

function SortableHeaderCell({
  header,
  activeSorts,
  onSortClick,
  isLast,
  isResizing,
  onResizeStart,
  onOpenConfig,
}: SortableHeaderCellProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: header.column.id });
  const meta = osSortHeaderMeta(activeSorts, header.id);
  const sortable = header.column.getCanSort();

  return (
    <th
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={cn(
        "relative max-w-0 select-none overflow-hidden px-2 py-1.5 text-left text-xs font-semibold",
        sortable ? "cursor-pointer" : "cursor-grab",
        isLast && "pr-9",
        isDragging && "z-20 bg-secondary-blue opacity-90 shadow-md",
      )}
      style={{
        // Largura vem do <colgroup> (percentual). Apenas eixo X: reordenação horizontal.
        transform: transform ? `translate3d(${transform.x}px, 0, 0)` : undefined,
        transition,
      }}
      onClick={sortable ? () => onSortClick(header.id) : undefined}
      data-testid={homeTestIds.osTableSort(header.id)}
      data-column-id={header.column.id}
    >
      <span className="inline-flex max-w-full min-w-0 items-center gap-0.5">
        <span className="min-w-0 truncate">
          {flexRender(header.column.columnDef.header, header.getContext())}
        </span>
        {sortable ? (
        <span className="inline-flex shrink-0 flex-col items-center justify-center leading-none">
          {meta.badge ? (
            <span
              className="text-[0.55rem] font-bold leading-none"
              data-testid={homeTestIds.osTableSortBadge(header.id)}
            >
              {meta.badge}
            </span>
          ) : null}
          {meta.dir === "desc" ? (
            <ArrowUp className="size-3.5" />
          ) : meta.dir === "asc" ? (
            <ArrowDown className="size-3.5" />
          ) : (
            <ArrowUpDown className="size-3.5 opacity-50" />
          )}
        </span>
        ) : null}
      </span>
      {isLast ? (
        <span className="absolute inset-y-0 right-0 flex w-8 items-center justify-center">
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onOpenConfig();
            }}
            className="rounded p-1 text-white/90 hover:bg-white/15 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
            title="Configurar lista"
            aria-label="Configurar lista"
            data-testid={homeTestIds.osTableConfig}
          >
            <Settings className="size-4" aria-hidden />
          </button>
        </span>
      ) : (
        <span
          role="separator"
          aria-orientation="vertical"
          title="Arraste para ajustar a largura"
          aria-label={`Redimensionar coluna ${OS_HOME_TABLE_COLUMN_LABELS[header.column.id as OsHomeTableColumnId] ?? header.column.id}`}
          data-testid={homeTestIds.osTableResize(header.id)}
          className={cn(
            "absolute inset-y-0 right-0 z-10 w-1.5 cursor-col-resize touch-none select-none hover:bg-white/50",
            isResizing && "bg-white/70",
          )}
          // Não iniciar drag de reordenação nem sort a partir do handle.
          onPointerDown={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => {
            if (e.button !== 0) return;
            e.stopPropagation();
            e.preventDefault();
            onResizeStart(header.column.id, e.clientX, e.currentTarget.closest("th"));
          }}
          onTouchStart={(e) => {
            const touch = e.touches[0];
            if (!touch || e.touches.length > 1) return;
            e.stopPropagation();
            onResizeStart(header.column.id, touch.clientX, e.currentTarget.closest("th"));
          }}
        />
      )}
    </th>
  );
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
  sorts?: OsSortKey[];
  onSortChange: (sorts: OsSortKey[]) => void;
  onExportReport?: () => void;
  isExporting?: boolean;
  exportDisabled?: boolean;
  /** Duplo clique na linha abre o modal de detalhes da gerência. */
  onOpenGerenciaDetail?: (row: OsSearchRow) => void;
  /** Lista ocupa o espaço dos painéis de detalhes e histórico. */
  listExpanded?: boolean;
  onListExpandedChange?: (expanded: boolean) => void;
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
  sorts,
  onSortChange,
  onExportReport,
  isExporting = false,
  exportDisabled = false,
  onOpenGerenciaDetail,
  listExpanded = false,
  onListExpandedChange,
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

  const collapseListIfExpanded = useCallback(() => {
    if (listExpanded) {
      onListExpandedChange?.(false);
    }
  }, [listExpanded, onListExpandedChange]);

  const handleSelectRow = useCallback(
    (row: OsSearchRow | null) => {
      if (selectionLocked) {
        return;
      }
      collapseListIfExpanded();
      startSelectionTransition(() => {
        onSelectRow(row ? normalizeOsSelection(row) : null);
      });
    },
    [collapseListIfExpanded, onSelectRow, selectionLocked],
  );

  const handleContextSelectRow = useCallback(
    (row: OsSearchRow | null) => {
      collapseListIfExpanded();
      onSelectRow(row);
    },
    [collapseListIfExpanded, onSelectRow],
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

  const activeSorts = useMemo(
    () => resolveOsSorts({ sorts, sortBy, sortDir }),
    [sortBy, sortDir, sorts],
  );

  const sorting: SortingState = useMemo(
    () => activeSorts.map((item) => ({ id: item.column, desc: item.dir === "desc" })),
    [activeSorts],
  );

  const isAuthenticated = useAuthStore((s) => s.user != null);
  const [tableLayout, setTableLayout] = useState<OsHomeTableLayout>(
    () => readLocalOsHomeTableLayout(),
  );

  const handleRemoteLayoutLoaded = useCallback((value: OsHomeTableLayout) => {
    setTableLayout(mergeOsHomeTableLayout(value));
  }, []);

  useUserPreferenceSync<OsHomeTableLayout>({
    key: "os_home_table_layout",
    enabled: isAuthenticated,
    watchValue: tableLayout,
    onRemoteLoaded: handleRemoteLayoutLoaded,
  });

  const columnSizing: ColumnSizingState = tableLayout.widths;
  const columnVisibility: VisibilityState = tableLayout.visibility;
  const columnOrder: ColumnOrderState = tableLayout.order;

  const onColumnVisibilityChange: OnChangeFn<VisibilityState> = useCallback(
    (updater) => {
      setTableLayout((prev) => ({
        ...prev,
        visibility: normalizeOsHomeTableVisibility(
          functionalUpdate(updater, prev.visibility as VisibilityState),
          prev.visibility,
        ),
      }));
    },
    [],
  );

  const onColumnOrderChange: OnChangeFn<ColumnOrderState> = useCallback(
    (updater) => {
      setTableLayout((prev) =>
        mergeOsHomeTableLayout({
          ...prev,
          order: functionalUpdate(updater, prev.order as ColumnOrderState),
        }),
      );
    },
    [],
  );

  const table = useReactTable({
    data: displayRows,
    columns,
    state: { sorting, columnSizing, columnVisibility, columnOrder },
    manualSorting: true,
    onColumnVisibilityChange,
    onColumnOrderChange,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (row) => displayRowId(row),
  });

  /** Click residual após resize/drag não deve ordenar. */
  const suppressHeaderClickUntilRef = useRef(0);
  const suppressHeaderClick = useCallback(() => {
    suppressHeaderClickUntilRef.current = Date.now() + HEADER_CLICK_SUPPRESS_MS;
  }, []);

  const [resizingColumnId, setResizingColumnId] = useState<string | null>(null);
  const [configOpen, setConfigOpen] = useState(false);

  const visibleLeafColumns = table.getVisibleLeafColumns();
  const visibleColumnIds = visibleLeafColumns.map((column) => column.id);
  const visibleColumnCount = Math.max(1, visibleLeafColumns.length);
  /** A lista sempre ocupa 100%: cada coluna recebe sua fração (responsivo à janela). */
  const columnPercents = useMemo(
    () => osHomeTableColumnPercents(tableLayout),
    [tableLayout],
  );

  /**
   * Resize pela borda direita do header: troca largura apenas com a coluna vizinha
   * à direita (as demais não mudam e a lista continua com 100% da largura).
   */
  const handleResizeStart = useCallback(
    (columnId: string, startX: number, th: HTMLElement | null) => {
      const visible = visibleOsHomeTableColumns(tableLayout);
      const index = visible.indexOf(columnId as OsHomeTableColumnId);
      const leftId = visible[index];
      const rightId = visible[index + 1];
      if (index < 0 || leftId === undefined || rightId === undefined) {
        return;
      }
      suppressHeaderClick();

      // Larguras atuais em px (pesos na escala da janela atual).
      const rendered = new Map<OsHomeTableColumnId, number>();
      th?.closest("tr")
        ?.querySelectorAll<HTMLElement>("th[data-column-id]")
        .forEach((cell) => {
          const id = cell.dataset.columnId;
          const width = cell.getBoundingClientRect().width;
          if (isOsHomeTableColumnId(id) && width > 0) {
            rendered.set(id, width);
          }
        });
      const hasRendered = visible.every((id) => rendered.has(id));
      const snapshot = new Map<OsHomeTableColumnId, number>(
        visible.map((id) => [id, hasRendered ? rendered.get(id)! : tableLayout.widths[id]]),
      );
      const startLeft = snapshot.get(leftId) ?? 0;
      const startRight = snapshot.get(rightId) ?? 0;
      setResizingColumnId(columnId);

      const move = (clientX: number) => {
        const pair = resizeOsHomeTableColumnPair(
          startLeft,
          startRight,
          leftId,
          rightId,
          clientX - startX,
        );
        setTableLayout((prev) => {
          const widths = { ...prev.widths };
          for (const [id, width] of snapshot) {
            widths[id] = Math.max(1, Math.round(width));
          }
          widths[leftId] = pair.left;
          widths[rightId] = pair.right;
          return { ...prev, widths };
        });
      };
      const onMouseMove = (e: MouseEvent) => move(e.clientX);
      const onTouchMove = (e: TouchEvent) => {
        const touch = e.touches[0];
        if (touch) move(touch.clientX);
      };
      const end = () => {
        suppressHeaderClick();
        setResizingColumnId(null);
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", end);
        document.removeEventListener("touchmove", onTouchMove);
        document.removeEventListener("touchend", end);
        document.removeEventListener("touchcancel", end);
      };
      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", end);
      document.addEventListener("touchmove", onTouchMove);
      document.addEventListener("touchend", end);
      document.addEventListener("touchcancel", end);
    },
    [suppressHeaderClick, tableLayout],
  );

  const handleHeaderSortClick = useCallback(
    (columnId: string) => {
      if (Date.now() < suppressHeaderClickUntilRef.current) {
        return;
      }
      if (!isOsHomeTableColumnSortable(columnId)) {
        return;
      }
      onSortChange(cycleOsSortKeys(activeSorts, columnId as OsSortColumn));
    },
    [activeSorts, onSortChange],
  );

  const dndSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );

  const handleHeaderDragEnd = useCallback(
    ({ active, over }: DragEndEvent) => {
      suppressHeaderClick();
      if (!over || active.id === over.id) {
        return;
      }
      setTableLayout((prev) => ({
        ...prev,
        order: moveOsHomeTableColumn(prev.order, String(active.id), String(over.id)),
      }));
    },
    [suppressHeaderClick],
  );

  const handleApplyConfig = useCallback((next: OsHomeTableLayout) => {
    setTableLayout(mergeOsHomeTableLayout(next));
    setConfigOpen(false);
  }, []);

  const handleCloseConfig = useCallback(() => setConfigOpen(false), []);
  const handleOpenConfig = useCallback(() => setConfigOpen(true), []);

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
  }, [isFetching, isLoading, rows.length]);

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
          "relative min-h-0 flex-1 overflow-x-hidden overflow-y-auto",
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
        {/* Tabela — tablet/desktop: sempre 100% da largura; colunas em % (responsivo). */}
        <DndContext
          sensors={dndSensors}
          collisionDetection={closestCenter}
          onDragStart={suppressHeaderClick}
          onDragCancel={suppressHeaderClick}
          onDragEnd={handleHeaderDragEnd}
        >
        <table className="hidden w-full min-w-0 table-fixed border-collapse text-sm md:table">
          {/* Fração de cada coluna na largura total: acompanha o tamanho da janela. */}
          <colgroup>
            {visibleLeafColumns.map((column) => (
              <col
                key={column.id}
                data-column-id={column.id}
                style={{
                  width: `${(columnPercents.get(column.id as OsHomeTableColumnId) ?? 0).toFixed(4)}%`,
                }}
              />
            ))}
          </colgroup>
          <thead className="sticky top-0 z-10 bg-secondary-blue text-white">
            {headerGroups.map((hg) => (
              <tr key={hg.id}>
                <SortableContext
                  items={visibleColumnIds}
                  strategy={horizontalListSortingStrategy}
                >
                  {hg.headers.map((header, index) => (
                    <SortableHeaderCell
                      key={header.id}
                      header={header}
                      activeSorts={activeSorts}
                      onSortClick={handleHeaderSortClick}
                      isLast={index === hg.headers.length - 1}
                      isResizing={resizingColumnId === header.column.id}
                      onResizeStart={handleResizeStart}
                      onOpenConfig={handleOpenConfig}
                    />
                  ))}
                </SortableContext>
              </tr>
            ))}
          </thead>
          <tbody>
            {isError && (
              <tr>
                <td
                  colSpan={visibleColumnCount}
                  className="px-4 py-8 text-center text-sagra-danger"
                >
                  {errorMessage ?? "Erro ao carregar ordens de serviço."}
                </td>
              </tr>
            )}
            {!isError && isLoading && rows.length === 0 && (
              <tr>
                <td
                  colSpan={visibleColumnCount}
                  className="px-4 py-8 text-center text-neutral-500"
                >
                  Carregando...
                </td>
              </tr>
            )}
            {!isError && !isLoading && rows.length === 0 && (
              <tr>
                <td
                  colSpan={visibleColumnCount}
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
                    <td colSpan={visibleColumnCount} />
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
                      onSelectRow={handleContextSelectRow}
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
                            className="max-w-0 overflow-hidden px-2 py-1 align-middle"
                            data-column-id={cell.column.id}
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
                    <td colSpan={visibleColumnCount} />
                  </tr>
                )}
              </>
            )}
          </tbody>
        </table>
        </DndContext>

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
                    onSelectRow={handleContextSelectRow}
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
            className="sagra-btn sagra-btn--report sagra-btn--sm shrink-0"
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

      {onListExpandedChange ? (
        <button
          type="button"
          onClick={() => onListExpandedChange(!listExpanded)}
          disabled={selectionLocked}
          className="hidden h-6 w-full items-center justify-center border-t border-sagra-border bg-slate-50/80 text-neutral-500 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60 lg:flex"
          aria-expanded={listExpanded}
          aria-controls={homeTestIds.osHomeDetailsHistory}
          aria-label={
            listExpanded ? "Recolher lista de OS" : "Expandir lista de OS"
          }
          data-testid={homeTestIds.osTableExpandToggle}
        >
          {listExpanded ? (
            <ChevronUp className="size-4" />
          ) : (
            <ChevronDown className="size-4" />
          )}
        </button>
      ) : null}
      <OsListConfigModal
        open={configOpen}
        layout={tableLayout}
        onClose={handleCloseConfig}
        onApply={handleApplyConfig}
      />
    </section>
  );
}
