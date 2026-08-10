import {
  Columns2,
  Loader2,
  Maximize,
  Square,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type {
  AnaliseLabEdge,
  AnaliseLabMark,
  AnaliseLabMarkCor,
} from "@/api/analiseLab";
import type { ProvaWebPageMeta } from "@/api/provaWeb";

import { AnaliseLabInspectorPage } from "./AnaliseLabInspectorPage";
import type { AnaliseLabTool } from "./AnaliseLabMarkTools";
import { formatMm, pageSizeMm } from "./analiseLabGeometry";
import {
  buildSpreadRows,
  findRowIndexForPage,
  fitZoom,
  loadInspectorViewMode,
  saveInspectorViewMode,
  type InspectorViewMode,
} from "./analiseLabFit";

interface AnaliseLabInspectorProps {
  pages: ProvaWebPageMeta[];
  pageTarget?: { page: number; nonce: number } | null;
  onPageChange: (page: number) => void;
  resolveUrl: (page: number) => string;
  marks: AnaliseLabMark[];
  tool: AnaliseLabTool;
  edge: AnaliseLabEdge;
  applyAllPages: boolean;
  cor: AnaliseLabMarkCor;
  rotulo: string;
  espessura: number;
  selectedMarkId?: number | null;
  onCreateGeometryMark: (args: {
    tipo:
      | "ponto"
      | "retangulo"
      | "medida"
      | "seta"
      | "circulo"
      | "texto"
      | "livre";
    geometria: Record<string, number | string | number[][]>;
    pagina: number;
  }) => void;
  onCreateFaixaDrag: (args: {
    fromMm: number;
    toMm: number;
    pagina: number;
  }) => void;
}

export function AnaliseLabInspector({
  pages,
  pageTarget,
  onPageChange,
  resolveUrl,
  marks,
  tool,
  edge,
  applyAllPages: _applyAllPages,
  cor,
  rotulo: _rotulo,
  espessura,
  selectedMarkId = null,
  onCreateGeometryMark,
  onCreateFaixaDrag,
}: AnaliseLabInspectorProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const suppressObserverRef = useRef(false);
  const [viewMode, setViewMode] = useState<InspectorViewMode>(() =>
    loadInspectorViewMode(),
  );
  const [zoom, setZoom] = useState(1);
  const [fitMode, setFitMode] = useState(true);
  const [avail, setAvail] = useState({ width: 800, height: 1000 });
  const [loadedPages, setLoadedPages] = useState<Set<number>>(() => new Set());
  const [activePage, setActivePage] = useState(pages[0]?.page ?? 1);

  const rows = useMemo(
    () => buildSpreadRows(pages, viewMode),
    [pages, viewMode],
  );

  const firstRowPages = rows[0] ?? [];
  const fitBase = useMemo(() => {
    const sizes = (firstRowPages.length ? firstRowPages : pages.slice(0, 1)).map(
      (p) => ({
        width: p.width || 800,
        height: p.height || 1130,
      }),
    );
    return fitZoom(sizes, avail);
  }, [avail, firstRowPages, pages]);

  useEffect(() => {
    if (fitMode) setZoom(fitBase);
  }, [fitBase, fitMode]);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const measure = () => {
      setAvail({
        width: el.clientWidth,
        height: el.clientHeight,
      });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    saveInspectorViewMode(viewMode);
  }, [viewMode]);

  // Lazy load + active page via intersection observer on rows
  useEffect(() => {
    const root = scrollerRef.current;
    if (!root || !rows.length) return;
    const ratios = new Map<number, number>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const rowIdx = Number(
            (entry.target as HTMLElement).dataset.rowIndex || -1,
          );
          if (rowIdx < 0) continue;
          ratios.set(rowIdx, entry.isIntersecting ? entry.intersectionRatio : 0);
          if (entry.isIntersecting) {
            const row = rows[rowIdx];
            if (row) {
              setLoadedPages((prev) => {
                const next = new Set(prev);
                for (const p of row) next.add(p.page);
                // prefetch neighbors
                for (const n of [rowIdx - 1, rowIdx + 1]) {
                  const neighbor = rows[n];
                  if (neighbor) {
                    for (const p of neighbor) next.add(p.page);
                  }
                }
                return next;
              });
            }
          }
        }
        if (suppressObserverRef.current) return;
        let bestIdx = 0;
        let bestRatio = -1;
        for (const [idx, ratio] of ratios) {
          if (ratio > bestRatio) {
            bestRatio = ratio;
            bestIdx = idx;
          }
        }
        const row = rows[bestIdx];
        const page = row?.[0]?.page;
        if (page != null) {
          setActivePage(page);
          onPageChange(page);
        }
      },
      { root, rootMargin: "100% 0px", threshold: [0, 0.15, 0.35, 0.55, 0.75] },
    );
    for (const [idx, el] of rowRefs.current) {
      if (idx < rows.length) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [onPageChange, rows]);

  const scrollToPage = useCallback(
    (pageNumber: number) => {
      const rowIdx = findRowIndexForPage(rows, pageNumber);
      const el = rowRefs.current.get(rowIdx);
      if (!el) return;
      suppressObserverRef.current = true;
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      setActivePage(pageNumber);
      window.setTimeout(() => {
        suppressObserverRef.current = false;
      }, 500);
    },
    [rows],
  );

  useEffect(() => {
    if (!pageTarget?.page) return;
    scrollToPage(pageTarget.page);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageTarget?.nonce, pageTarget?.page]);

  // Seed first pages as loaded
  useEffect(() => {
    if (!pages.length) return;
    setLoadedPages((prev) => {
      const next = new Set(prev);
      for (const p of pages.slice(0, 3)) next.add(p.page);
      return next;
    });
  }, [pages]);

  if (!pages.length) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-neutral-500">
        Sem páginas renderizadas.
      </div>
    );
  }

  const activeMeta = pages.find((p) => p.page === activePage) ?? pages[0];
  const { widthMm, heightMm } = pageSizeMm(
    activeMeta?.widthPt || 0,
    activeMeta?.heightPt || 0,
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-slate-200/70">
      <div className="flex shrink-0 flex-wrap items-center justify-center gap-2 border-b border-sagra-border bg-white px-3 py-2">
        <span className="tabular-nums text-xs text-neutral-700">
          Página {activePage} / {pages.length}
        </span>
        <button
          type="button"
          onClick={() => {
            setFitMode(false);
            setZoom((z) => Math.max(0.25, z - 0.1));
          }}
          className="rounded border border-sagra-border p-1.5"
          title="Diminuir zoom"
        >
          <ZoomOut className="size-4" aria-hidden />
        </button>
        <button
          type="button"
          onClick={() => {
            setFitMode(false);
            setZoom((z) => Math.min(3, z + 0.1));
          }}
          className="rounded border border-sagra-border p-1.5"
          title="Aumentar zoom"
        >
          <ZoomIn className="size-4" aria-hidden />
        </button>
        <button
          type="button"
          onClick={() => {
            setFitMode(true);
            setZoom(fitBase);
          }}
          className={
            fitMode
              ? "rounded border border-primary-green bg-primary-green/10 p-1.5 text-primary-green"
              : "rounded border border-sagra-border p-1.5"
          }
          title="Ajustar à área"
        >
          <Maximize className="size-4" aria-hidden />
        </button>
        <button
          type="button"
          onClick={() => {
            setFitMode(false);
            setZoom(1);
          }}
          className="rounded border border-sagra-border px-2 py-1 text-[11px] font-medium"
          title="100%"
        >
          100%
        </button>
        <button
          type="button"
          onClick={() =>
            setViewMode((m) => (m === "simples" ? "dupla" : "simples"))
          }
          className={
            viewMode === "dupla"
              ? "rounded border border-primary-green bg-primary-green/10 p-1.5 text-primary-green"
              : "rounded border border-sagra-border p-1.5"
          }
          title={
            viewMode === "dupla"
              ? "Página dupla (ativada)"
              : "Ativar página dupla"
          }
        >
          {viewMode === "dupla" ? (
            <Columns2 className="size-4" aria-hidden />
          ) : (
            <Square className="size-4" aria-hidden />
          )}
        </button>
        <span className="tabular-nums text-xs text-neutral-500">
          {Math.round(zoom * 100)}% · {formatMm(widthMm)} × {formatMm(heightMm)}
        </span>
      </div>

      <div ref={scrollerRef} className="relative min-h-0 flex-1 overflow-auto p-4">
        <div className="mx-auto flex flex-col gap-8">
          {rows.map((row, rowIdx) => (
            <div
              key={`row-${rowIdx}-${row.map((p) => p.page).join("-")}`}
              data-row-index={rowIdx}
              ref={(el) => {
                if (el) rowRefs.current.set(rowIdx, el);
                else rowRefs.current.delete(rowIdx);
              }}
              className="flex items-start justify-center gap-4"
            >
              {row.map((page, pageInRow) => (
                <AnaliseLabInspectorPage
                  key={page.page}
                  page={page}
                  zoom={zoom}
                  loadSrc={loadedPages.has(page.page)}
                  resolveUrl={resolveUrl}
                  marks={marks}
                  tool={tool}
                  edge={edge}
                  cor={cor}
                  espessura={espessura}
                  selectedMarkId={selectedMarkId}
                  showLeftRuler={pageInRow === 0}
                  interactive
                  onCreateGeometryMark={onCreateGeometryMark}
                  onCreateFaixaDrag={onCreateFaixaDrag}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function AnaliseLabInspectorLoading() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2">
      <Loader2 className="size-8 animate-spin text-primary-green" aria-hidden />
      <p className="text-sm text-neutral-600">Carregando inspeção…</p>
    </div>
  );
}
