import {
  ChevronLeft,
  ChevronRight,
  Columns2,
  Maximize,
  Square,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type WheelEvent } from "react";

import {
  provaWebPageUrl,
  type ProvaWebManifestBase,
  type ProvaWebPageMeta,
} from "@/api/provaWeb";
import {
  buildSpreadRows,
  findRowIndexForPage,
  fitZoom,
  nextZoomFromWheel,
  pageDisplaySize,
  stepRowPage,
  zoomStep,
  type InspectorViewMode,
} from "@/features/analise-lab/analiseLabFit";

const SHEETS_VIEW_STORAGE_KEY = "prova-web:sheets-view";

export function loadSheetsViewMode(): InspectorViewMode {
  try {
    const raw = localStorage.getItem(SHEETS_VIEW_STORAGE_KEY);
    if (raw === "dupla" || raw === "simples") return raw;
  } catch {
    /* ignore */
  }
  return "simples";
}

export function saveSheetsViewMode(modo: InspectorViewMode): void {
  try {
    localStorage.setItem(SHEETS_VIEW_STORAGE_KEY, modo);
  } catch {
    /* ignore */
  }
}

interface ProvaWebSheetsViewerProps {
  ano: number;
  osId: number;
  manifest: ProvaWebManifestBase;
  buildPageUrl?: (page: number) => string;
  pageTarget?: { page: number; nonce: number } | null;
  onPageChange?: (page: number) => void;
}

export function ProvaWebSheetsViewer({
  ano,
  osId,
  manifest,
  buildPageUrl,
  pageTarget,
  onPageChange,
}: ProvaWebSheetsViewerProps) {
  const pages = manifest.pages;
  const total = pages.length;
  const scrollerRef = useRef<HTMLDivElement>(null);
  const onPageChangeRef = useRef(onPageChange);
  onPageChangeRef.current = onPageChange;
  const lastNonceRef = useRef<number | null>(null);

  const [viewMode, setViewMode] = useState<InspectorViewMode>(() =>
    loadSheetsViewMode(),
  );
  const [zoom, setZoom] = useState(1);
  const [fitMode, setFitMode] = useState(true);
  const [avail, setAvail] = useState({ width: 800, height: 1000 });
  const [activePage, setActivePage] = useState(pages[0]?.page ?? 1);

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
    saveSheetsViewMode(viewMode);
  }, [viewMode]);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const measure = () => {
      setAvail({
        width: Math.max(40, el.clientWidth),
        height: Math.max(40, el.clientHeight),
      });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const pageUrl = useCallback(
    (page: ProvaWebPageMeta) =>
      buildPageUrl
        ? buildPageUrl(page.page)
        : provaWebPageUrl(ano, osId, page.page, manifest.cacheKey),
    [ano, buildPageUrl, manifest.cacheKey, osId],
  );

  const goToPage = useCallback(
    (page: number) => {
      if (!pages.some((p) => p.page === page)) return;
      setActivePage(page);
      onPageChangeRef.current?.(page);
      const rowIdx = findRowIndexForPage(rows, page);
      const rowEl = scrollerRef.current?.querySelector(
        `[data-sheet-row="${rowIdx}"]`,
      );
      rowEl?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    },
    [pages, rows],
  );

  useEffect(() => {
    if (!pageTarget) return;
    if (lastNonceRef.current === pageTarget.nonce) return;
    lastNonceRef.current = pageTarget.nonce;
    goToPage(pageTarget.page);
  }, [goToPage, pageTarget]);

  const goPrev = useCallback(() => {
    const next = stepRowPage(rows, activePage, -1);
    if (next != null) goToPage(next);
  }, [activePage, goToPage, rows]);

  const goNext = useCallback(() => {
    const next = stepRowPage(rows, activePage, 1);
    if (next != null) goToPage(next);
  }, [activePage, goToPage, rows]);

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
      if (event.key === "ArrowRight" || event.key === "PageDown") {
        goNext();
      } else if (event.key === "ArrowLeft" || event.key === "PageUp") {
        goPrev();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goNext, goPrev]);

  const onScrollerWheel = (event: WheelEvent<HTMLDivElement>) => {
    const next = nextZoomFromWheel(zoom, event.deltaY, event.ctrlKey);
    if (next == null) return;
    event.preventDefault();
    setFitMode(false);
    setZoom(next);
  };

  if (!total) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-neutral-500">
        Sem páginas renderizadas.
      </div>
    );
  }

  const rowIdx = findRowIndexForPage(rows, activePage);
  const duplexTight = viewMode === "dupla";

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-slate-200/70">
      <div className="flex shrink-0 flex-wrap items-center justify-center gap-1.5 border-b border-sagra-border bg-white px-3 py-2">
        <ToolbarButton onClick={goPrev} disabled={rowIdx <= 0} label="Anterior">
          <ChevronLeft className="size-4" aria-hidden />
        </ToolbarButton>
        <span className="min-w-16 text-center text-xs tabular-nums text-neutral-600">
          {activePage} / {total}
        </span>
        <ToolbarButton
          onClick={goNext}
          disabled={rowIdx >= rows.length - 1}
          label="Próxima"
        >
          <ChevronRight className="size-4" aria-hidden />
        </ToolbarButton>
        <span className="mx-1 hidden h-5 w-px bg-sagra-border sm:inline" aria-hidden />
        <ToolbarButton
          onClick={() => {
            setFitMode(false);
            setZoom(zoomStep(zoom, -1));
          }}
          label="Reduzir"
        >
          <ZoomOut className="size-4" aria-hidden />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => {
            setFitMode(false);
            setZoom(zoomStep(zoom, 1));
          }}
          label="Ampliar"
        >
          <ZoomIn className="size-4" aria-hidden />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => {
            setFitMode(true);
            setZoom(fitBase);
          }}
          label="Ajustar à área"
        >
          <Maximize className="size-4" aria-hidden />
        </ToolbarButton>
        <ToolbarButton
          onClick={() =>
            setViewMode((m) => (m === "simples" ? "dupla" : "simples"))
          }
          label={
            viewMode === "dupla" ? "Página dupla (ativada)" : "Ativar página dupla"
          }
        >
          {viewMode === "dupla" ? (
            <Columns2 className="size-4" aria-hidden />
          ) : (
            <Square className="size-4" aria-hidden />
          )}
        </ToolbarButton>
        <span className="tabular-nums text-[11px] text-neutral-500">
          {Math.round(zoom * 100)}%
        </span>
      </div>

      <div
        ref={scrollerRef}
        className="relative min-h-0 flex-1 overflow-auto p-4"
        onWheel={onScrollerWheel}
      >
        <div className="mx-auto flex w-full flex-col gap-8">
          {rows.map((row, idx) => (
            <div
              key={`row-${idx}-${row.map((p) => p.page).join("-")}`}
              data-sheet-row={idx}
              className={
                duplexTight
                  ? "flex items-start justify-center gap-0"
                  : "flex items-start justify-center gap-4"
              }
            >
              {row.map((page) => {
                const size = pageDisplaySize(page, zoom);
                const active = activePage === page.page;
                return (
                  <button
                    key={page.page}
                    type="button"
                    onClick={() => goToPage(page.page)}
                    className={`overflow-hidden bg-white shadow-md ring-offset-2 ${
                      active
                        ? "ring-2 ring-primary-green"
                        : "ring-1 ring-black/10"
                    }`}
                    style={{ width: size.width, height: size.height }}
                    aria-current={active ? "true" : undefined}
                    aria-label={`Página ${page.page} de ${total}`}
                  >
                    <img
                      src={pageUrl(page)}
                      alt={`Página ${page.page} de ${total}`}
                      className="block size-full object-contain"
                      draggable={false}
                    />
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ToolbarButton({
  onClick,
  disabled,
  label,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className="rounded-lg border border-sagra-border bg-white p-2 text-neutral-700 shadow-sm transition hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-30"
    >
      {children}
    </button>
  );
}
