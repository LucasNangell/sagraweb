import { Loader2 } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import type {
  AnaliseLabEdge,
  AnaliseLabMark,
  AnaliseLabMarkCor,
} from "@/api/analiseLab";
import type { ProvaWebPageMeta } from "@/api/provaWeb";

import { AnaliseLabInspectorPage } from "./AnaliseLabInspectorPage";
import type { AnaliseLabTool } from "./AnaliseLabMarkTools";
import {
  AnaliseLabToolbar,
  type AnaliseLabToolbarMarkProps,
} from "./AnaliseLabToolbar";
import { formatMm, pageSizeMm } from "./analiseLabGeometry";
import {
  anchorScrollAfterZoom,
  buildSpreadRows,
  findRowIndexForPage,
  fitZoom,
  loadInspectorViewMode,
  nextZoomFromWheel,
  pageDisplaySize,
  resolveActivePageFromScroll,
  saveInspectorViewMode,
  stepRowPage,
  zoomStep,
  type InspectorViewMode,
} from "./analiseLabFit";
import {
  addGuideMm,
  moveGuideMm,
  removeGuideMm,
  type InspectorViewPrefs,
} from "./analiseLabViewPrefs";

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
  sangriaMm?: number;
  markTools: AnaliseLabToolbarMarkProps;
  /** Com painel do problema aberto, opções da marca ficam no painel. */
  hideMarkOptions?: boolean;
  /** Folhear browse: sem réguas/grade/guias/offset. */
  hideViewAids?: boolean;
  prefs: InspectorViewPrefs;
  onPrefsChange: (prefs: InspectorViewPrefs) => void;
  pagePick?: {
    label: string;
    pages: number[];
    onTogglePage: (page: number) => void;
    onFinish: () => void;
  } | null;
  onSelectMark?: (markId: number) => void;
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
  onCreateSangriaDrag?: (args: {
    fromMm: number;
    toMm: number;
    alongFromMm: number;
    alongToMm: number;
    pagina: number;
  }) => void;
  /** Reserva à direita para balões (Folhear folhas). */
  stageGutterRight?: number;
  renderStageOverlay?: (ctx: {
    visiblePages: ProvaWebPageMeta[];
    pageSize: { width: number; height: number };
    slotWidth: number;
    gutterRight: number;
    isSpread: boolean;
    flipping: boolean;
    pageRectsOverride: Record<
      number,
      {
        left: number;
        top: number;
        width: number;
        height: number;
        widthMm: number;
        heightMm: number;
      }
    >;
  }) => ReactNode;
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
  markTools,
  hideMarkOptions = false,
  hideViewAids = false,
  prefs,
  onPrefsChange,
  pagePick = null,
  onSelectMark,
  onCreateGeometryMark,
  onCreateFaixaDrag,
  onCreateSangriaDrag,
  stageGutterRight = 0,
  renderStageOverlay,
}: AnaliseLabInspectorProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
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
  const [balloonCtx, setBalloonCtx] = useState<{
    visiblePages: ProvaWebPageMeta[];
    pageSize: { width: number; height: number };
    slotWidth: number;
    gutterRight: number;
    isSpread: boolean;
    flipping: boolean;
    pageRectsOverride: Record<
      number,
      {
        left: number;
        top: number;
        width: number;
        height: number;
        widthMm: number;
        heightMm: number;
      }
    >;
  } | null>(null);

  zoomRef.current = zoom;
  activePageRef.current = activePage;

  const rows = useMemo(
    () => buildSpreadRows(pages, viewMode),
    [pages, viewMode],
  );

  const firstRowPages = rows[0] ?? [];
  const fitBase = useMemo(() => {
    const sizes = (firstRowPages.length ? firstRowPages : pages.slice(0, 1)).map(
      (p) => pageDisplaySize(p, 1),
    );
    return fitZoom(sizes, avail, {
      gutterPx: viewMode === "dupla" ? 0 : undefined,
    });
  }, [avail, firstRowPages, pages, viewMode]);

  useEffect(() => {
    if (fitMode) setZoom(fitBase);
  }, [fitBase, fitMode]);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const measure = () => {
      setAvail({
        width: Math.max(40, el.clientWidth - stageGutterRight),
        height: el.clientHeight,
      });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [stageGutterRight]);

  useEffect(() => {
    if (!renderStageOverlay || stageGutterRight <= 0) {
      setBalloonCtx(null);
      return;
    }
    const stage = stageRef.current;
    const scroller = scrollerRef.current;
    if (!stage || !scroller) return;

    const measureBalloons = () => {
      const stageBox = stage.getBoundingClientRect();
      const viewportTop = scroller.scrollTop;
      const viewportBottom = viewportTop + scroller.clientHeight;
      const visible: ProvaWebPageMeta[] = [];
      const pageRectsOverride: Record<
        number,
        {
          left: number;
          top: number;
          width: number;
          height: number;
          widthMm: number;
          heightMm: number;
        }
      > = {};

      for (const page of pages) {
        const node = scroller.querySelector(
          `[data-lab-page="${page.page}"]`,
        ) as HTMLElement | null;
        if (!node) continue;
        const rect = node.getBoundingClientRect();
        const top = rect.top - stageBox.top;
        const relTop =
          rect.top -
          scroller.getBoundingClientRect().top +
          scroller.scrollTop;
        const relBottom = relTop + rect.height;
        if (relBottom < viewportTop || relTop > viewportBottom) continue;

        const { widthMm, heightMm } = pageSizeMm(
          page.widthPt || 0,
          page.heightPt || 0,
        );
        visible.push(page);
        pageRectsOverride[page.page] = {
          left: rect.left - stageBox.left,
          top,
          width: rect.width,
          height: rect.height,
          widthMm,
          heightMm,
        };
      }

      if (!visible.length) {
        // Fallback: página ativa
        const active =
          pages.find((p) => p.page === activePageRef.current) ?? pages[0];
        if (active) {
          const node = scroller.querySelector(
            `[data-lab-page="${active.page}"]`,
          ) as HTMLElement | null;
          if (node) {
            const rect = node.getBoundingClientRect();
            const { widthMm, heightMm } = pageSizeMm(
              active.widthPt || 0,
              active.heightPt || 0,
            );
            visible.push(active);
            pageRectsOverride[active.page] = {
              left: rect.left - stageBox.left,
              top: rect.top - stageBox.top,
              width: rect.width,
              height: rect.height,
              widthMm,
              heightMm,
            };
          }
        }
      }

      if (!visible.length) {
        setBalloonCtx(null);
        return;
      }

      const firstRect = pageRectsOverride[visible[0]!.page];
      setBalloonCtx({
        visiblePages: visible,
        pageSize: firstRect
          ? { width: firstRect.width, height: firstRect.height }
          : { width: 400, height: 560 },
        slotWidth: Math.max(1, stage.clientWidth),
        gutterRight: stageGutterRight,
        isSpread: visible.length > 1,
        flipping: false,
        pageRectsOverride,
      });
    };

    measureBalloons();
    const ro = new ResizeObserver(measureBalloons);
    ro.observe(stage);
    ro.observe(scroller);
    scroller.addEventListener("scroll", measureBalloons, { passive: true });
    return () => {
      ro.disconnect();
      scroller.removeEventListener("scroll", measureBalloons);
    };
  }, [
    activePage,
    pages,
    renderStageOverlay,
    rows,
    stageGutterRight,
    viewMode,
    zoom,
  ]);

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
    (pageNumber: number, block: ScrollLogicalPosition = "start") => {
      const rowIdx = findRowIndexForPage(rows, pageNumber);
      const el = rowRefs.current.get(rowIdx);
      const root = scrollerRef.current;
      if (!el || !root) return false;
      suppressScrollSyncRef.current = true;
      el.scrollIntoView({ behavior: "auto", block });
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

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (!(event.ctrlKey || event.metaKey)) {
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
          event.preventDefault();
          const next = stepRowPage(
            rows,
            activePageRef.current,
            event.key === "ArrowLeft" ? -1 : 1,
          );
          if (next != null) {
            emitPageChange(next);
            scrollToPage(next, "center");
          }
        }
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
  }, [applyZoom, emitPageChange, fitBase, rows, scrollToPage]);

  const handleAddGuide = useCallback(
    (axis: "x" | "y", mm: number) => {
      onPrefsChange(addGuideMm(prefs, axis, mm));
    },
    [onPrefsChange, prefs],
  );

  const handleRemoveGuide = useCallback(
    (axis: "x" | "y", mm: number) => {
      onPrefsChange(removeGuideMm(prefs, axis, mm));
    },
    [onPrefsChange, prefs],
  );

  const handleMoveGuide = useCallback(
    (axis: "x" | "y", fromMm: number, toMm: number) => {
      onPrefsChange(moveGuideMm(prefs, axis, fromMm, toMm));
    },
    [onPrefsChange, prefs],
  );

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
  const duplexTight = viewMode === "dupla";

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-slate-200/70">
      <AnaliseLabToolbar
        mark={markTools}
        hideMarkOptions={hideMarkOptions}
        hideViewAids={hideViewAids}
        prefs={prefs}
        onPrefsChange={onPrefsChange}
        activePage={activePage}
        pageCount={pages.length}
        zoom={zoom}
        fitMode={fitMode}
        viewMode={viewMode}
        sizeLabel={`${formatMm(widthMm)} × ${formatMm(heightMm)}`}
        onZoomOut={() => applyZoom(zoomStep(zoom, -1))}
        onZoomIn={() => applyZoom(zoomStep(zoom, 1))}
        onZoom100={() => applyZoom(1)}
        onFit={() => {
          setFitMode(true);
          setZoom(fitBase);
        }}
        onToggleViewMode={() =>
          setViewMode((m) => (m === "simples" ? "dupla" : "simples"))
        }
      />

      {pagePick ? (
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-sky-200 bg-sky-50 px-3 py-1.5 text-xs text-sky-950">
          <span>
            {pagePick.label} — clique nas páginas para incluir ou remover.{" "}
            <strong>
              {pagePick.pages.length} selecionada
              {pagePick.pages.length === 1 ? "" : "s"}
            </strong>
          </span>
          <button
            type="button"
            className="rounded border border-sky-300 bg-white px-2 py-0.5 font-semibold"
            onClick={pagePick.onFinish}
          >
            Concluir
          </button>
        </div>
      ) : null}

      <div
        ref={scrollerRef}
        className="relative min-h-0 flex-1 overflow-auto p-4"
        style={
          stageGutterRight > 0
            ? { paddingRight: stageGutterRight + 16 }
            : undefined
        }
      >
        <div ref={stageRef} className="relative mx-auto flex w-full flex-col gap-8">
          {rows.map((row, rowIdx) => (
            <div
              key={`row-${rowIdx}-${row.map((p) => p.page).join("-")}`}
              data-row-index={rowIdx}
              ref={(el) => {
                if (el) rowRefs.current.set(rowIdx, el);
                else rowRefs.current.delete(rowIdx);
              }}
              className={
                duplexTight
                  ? "flex items-start justify-center gap-0 overflow-visible"
                  : "flex items-start justify-center gap-4 overflow-visible"
              }
            >
              {row.map((page, pageInRow) => {
                const paired = duplexTight && row.length === 2;
                const innerEdge = paired
                  ? pageInRow === 0
                    ? "right"
                    : "left"
                  : undefined;
                return (
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
                    showRulers={prefs.rulers}
                    grid={prefs.grid}
                    gridStepMm={prefs.gridStepMm}
                    guides={prefs.guides}
                    guidesXMm={prefs.guidesXMm}
                    guidesYMm={prefs.guidesYMm}
                    gridColor={prefs.gridColor}
                    guideColor={prefs.guideColor}
                    offset={prefs.offset}
                    offsetMm={prefs.offsetMm}
                    offsetColor={prefs.offsetColor}
                    pagePickActive={Boolean(pagePick)}
                    pagePicked={pagePick?.pages.includes(page.page) ?? false}
                    onTogglePickPage={pagePick?.onTogglePage}
                    onSelectMark={onSelectMark}
                    innerEdge={innerEdge}
                    tightActiveRing={paired}
                    interactive
                    active={activePage === page.page}
                    onActivate={() => activatePage(page.page)}
                    onAddGuide={handleAddGuide}
                    onRemoveGuide={handleRemoveGuide}
                    onMoveGuide={handleMoveGuide}
                    onCreateGeometryMark={onCreateGeometryMark}
                    onCreateFaixaDrag={onCreateFaixaDrag}
                    onCreateSangriaDrag={onCreateSangriaDrag}
                  />
                );
              })}
            </div>
          ))}
          {renderStageOverlay && balloonCtx
            ? renderStageOverlay(balloonCtx)
            : null}
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
