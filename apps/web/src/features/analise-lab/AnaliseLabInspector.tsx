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
  anchorScrollAfterZoom,
  buildSpreadRows,
  findRowIndexForPage,
  fitZoom,
  loadInspectorViewMode,
  nextZoomFromWheel,
  resolveActivePageFromScroll,
  saveInspectorViewMode,
  zoomStep,
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
  sangriaMm?: number;
  onCreateSangriaDrag?: (args: {
    fromMm: number;
    toMm: number;
    alongFromMm: number;
    alongToMm: number;
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
  sangriaMm = 5,
  selectedMarkId = null,
  onCreateGeometryMark,
  onCreateFaixaDrag,
  onCreateSangriaDrag,
}: AnaliseLabInspectorProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const suppressScrollSyncRef = useRef(false);
  const lastNonceRef = useRef<number | null>(null);
  const activePageRef = useRef(pages[0]?.page ?? 1);
  const zoomRef = useRef(1);
  const [viewMode, setViewMode] = useState<InspectorViewMode>(() =>
    loadInspectorViewMode(),
  );
  const [zoom, setZoom] = useState(1);
  const [fitMode, setFitMode] = useState(true);
  const [avail, setAvail] = useState({ width: 800, height: 1000 });
  const [loadedPages, setLoadedPages] = useState<Set<number>>(() => new Set());
  const [activePage, setActivePage] = useState(pages[0]?.page ?? 1);

  zoomRef.current = zoom;
  activePageRef.current = activePage;

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

  const emitPageChange = useCallback(
    (page: number) => {
      if (page === activePageRef.current) return;
      setActivePage(page);
      onPageChange(page);
    },
    [onPageChange],
  );

  // Lazy load via IntersectionObserver (não controla página ativa).
  useEffect(() => {
    const root = scrollerRef.current;
    if (!root || !rows.length) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const rowIdx = Number(
            (entry.target as HTMLElement).dataset.rowIndex || -1,
          );
          if (rowIdx < 0) continue;
          const row = rows[rowIdx];
          if (!row) continue;
          setLoadedPages((prev) => {
            const next = new Set(prev);
            for (const p of row) next.add(p.page);
            for (const n of [rowIdx - 1, rowIdx + 1]) {
              const neighbor = rows[n];
              if (neighbor) {
                for (const p of neighbor) next.add(p.page);
              }
            }
            return next;
          });
        }
      },
      { root, rootMargin: "100% 0px", threshold: [0, 0.1] },
    );
    for (const [idx, el] of rowRefs.current) {
      if (idx < rows.length) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [rows]);

  // Página ativa = linha sob o centro; na vista dupla, mantém a página
  // clicada enquanto a linha continuar visível.
  useEffect(() => {
    const root = scrollerRef.current;
    if (!root || !rows.length) return;
    let raf = 0;
    const syncActive = () => {
      if (suppressScrollSyncRef.current) return;
      const page = resolveActivePageFromScroll({
        rows,
        rowElements: rowRefs.current,
        scrollTop: root.scrollTop,
        viewportHeight: root.clientHeight,
        currentPage: activePageRef.current,
      });
      if (page != null) emitPageChange(page);
    };
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(syncActive);
    };
    root.addEventListener("scroll", onScroll, { passive: true });
    syncActive();
    return () => {
      cancelAnimationFrame(raf);
      root.removeEventListener("scroll", onScroll);
    };
  }, [emitPageChange, rows]);

  const activatePage = useCallback(
    (page: number) => {
      emitPageChange(page);
    },
    [emitPageChange],
  );

  const scrollToPage = useCallback(
    (pageNumber: number) => {
      const rowIdx = findRowIndexForPage(rows, pageNumber);
      const el = rowRefs.current.get(rowIdx);
      const root = scrollerRef.current;
      if (!el || !root) return false;
      suppressScrollSyncRef.current = true;
      // Instantâneo: smooth falhava na troca Folhear→Inspeção (sync voltava à pág. 1).
      el.scrollIntoView({ behavior: "auto", block: "start" });
      setActivePage(pageNumber);
      const release = () => {
        suppressScrollSyncRef.current = false;
      };
      const onScrollEnd = () => {
        root.removeEventListener("scrollend", onScrollEnd);
        release();
      };
      root.addEventListener("scrollend", onScrollEnd, { once: true });
      window.setTimeout(release, 120);
      return true;
    },
    [rows],
  );

  // Navega apenas quando o nonce muda (evita laço pageTarget ↔ onPageChange).
  // Só consome o nonce após scroll bem-sucedido (refs de linha prontas).
  useEffect(() => {
    if (!pageTarget?.page) return;
    if (lastNonceRef.current === pageTarget.nonce) return;
    let cancelled = false;
    let tries = 0;
    const attempt = () => {
      if (cancelled) return;
      if (scrollToPage(pageTarget.page)) {
        lastNonceRef.current = pageTarget.nonce;
        return;
      }
      if (tries < 30) {
        tries += 1;
        requestAnimationFrame(attempt);
      }
    };
    attempt();
    return () => {
      cancelled = true;
    };
  }, [pageTarget?.nonce, pageTarget?.page, scrollToPage]);

  useEffect(() => {
    if (!pages.length) return;
    setLoadedPages((prev) => {
      const next = new Set(prev);
      for (const p of pages.slice(0, 3)) next.add(p.page);
      return next;
    });
  }, [pages]);

  const applyZoom = useCallback(
    (next: number, pointer?: { x: number; y: number }) => {
      const root = scrollerRef.current;
      const oldZoom = zoomRef.current;
      const newZoom = next;
      setFitMode(false);
      setZoom(newZoom);
      if (!root || !pointer || oldZoom === newZoom) return;
      const anchored = anchorScrollAfterZoom({
        scrollLeft: root.scrollLeft,
        scrollTop: root.scrollTop,
        pointer,
        oldZoom,
        newZoom,
      });
      requestAnimationFrame(() => {
        root.scrollLeft = anchored.scrollLeft;
        root.scrollTop = anchored.scrollTop;
      });
    },
    [],
  );

  // Ctrl+scroll = zoom; scroll sozinho = rolagem contínua.
  useEffect(() => {
    const root = scrollerRef.current;
    if (!root) return;
    const onWheel = (event: WheelEvent) => {
      const next = nextZoomFromWheel(zoomRef.current, event.deltaY, event.ctrlKey);
      if (next == null) return;
      event.preventDefault();
      const rect = root.getBoundingClientRect();
      applyZoom(next, {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      });
    };
    root.addEventListener("wheel", onWheel, { passive: false });
    return () => root.removeEventListener("wheel", onWheel);
  }, [applyZoom]);

  // Ctrl + / - / 0
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (event.key === "=" || event.key === "+") {
        event.preventDefault();
        applyZoom(zoomStep(zoomRef.current, 1));
      } else if (event.key === "-") {
        event.preventDefault();
        applyZoom(zoomStep(zoomRef.current, -1));
      } else if (event.key === "0") {
        event.preventDefault();
        setFitMode(true);
        setZoom(fitBase);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [applyZoom, fitBase]);

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
          onClick={() => applyZoom(zoomStep(zoom, -1))}
          className="rounded border border-sagra-border p-1.5"
          title="Diminuir zoom (Ctrl+-)"
        >
          <ZoomOut className="size-4" aria-hidden />
        </button>
        <button
          type="button"
          onClick={() => applyZoom(zoomStep(zoom, 1))}
          className="rounded border border-sagra-border p-1.5"
          title="Aumentar zoom (Ctrl++)"
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
          title="Ajustar à área (Ctrl+0)"
        >
          <Maximize className="size-4" aria-hidden />
        </button>
        <button
          type="button"
          onClick={() => applyZoom(1)}
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
              className="flex items-start justify-center gap-4 overflow-visible"
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
                  sangriaMm={sangriaMm}
                  selectedMarkId={selectedMarkId}
                  showLeftRuler={pageInRow === 0}
                  interactive
                  active={activePage === page.page}
                  onActivate={() => activatePage(page.page)}
                  onCreateGeometryMark={onCreateGeometryMark}
                  onCreateFaixaDrag={onCreateFaixaDrag}
                  onCreateSangriaDrag={onCreateSangriaDrag}
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
