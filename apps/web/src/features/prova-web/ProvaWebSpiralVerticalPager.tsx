import {
  ChevronDown,
  ChevronUp,
  ChevronsDown,
  ChevronsUp,
  Maximize2,
  Minimize2,
  ZoomIn,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  provaWebPageUrl,
  type ProvaWebManifestBase,
  type ProvaWebPageMeta,
} from "@/api/provaWeb";

import {
  computeFlipbookPageSize,
  mergeLoadedWindow,
  seedLoadedWindow,
} from "./flipbookFit";
import "./prova-web-spiral-vertical-pager.css";

export interface ProvaWebSpiralVerticalPagerProps {
  ano: number;
  osId: number;
  manifest: ProvaWebManifestBase;
  buildPageUrl?: (page: number) => string;
}

/**
 * Folhear estilo calendário (wire-o no topo): páginas sobem/descem com pivot no topo.
 * Substitui page-flip quando spiralMockup.edge === "top".
 */
export function ProvaWebSpiralVerticalPager({
  ano,
  osId,
  manifest,
  buildPageUrl,
}: ProvaWebSpiralVerticalPagerProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const jumpInputRef = useRef<HTMLInputElement>(null);
  const jumpFocusedRef = useRef(false);
  const animatingRef = useRef(false);

  const pages = manifest.pages;
  const total = pages.length;
  const cacheKey = manifest.cacheKey;

  const resolveUrl = useCallback(
    (page: ProvaWebPageMeta) => {
      if (buildPageUrl) return buildPageUrl(page.page);
      return provaWebPageUrl(ano, osId, page.page, cacheKey);
    },
    [ano, buildPageUrl, cacheKey, osId],
  );

  const [pageIndex, setPageIndex] = useState(0);
  const [animDir, setAnimDir] = useState<"next" | "prev" | null>(null);
  const [zoomOpen, setZoomOpen] = useState(false);
  const [jumpDraft, setJumpDraft] = useState("1");
  const [loadedSrc, setLoadedSrc] = useState<Record<number, string>>(() =>
    seedLoadedWindow(pages, 0, resolveUrl),
  );
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [cssFullscreen, setCssFullscreen] = useState(false);
  const [stageSize, setStageSize] = useState({ w: 0, h: 0 });

  const pageMeta = useMemo(() => {
    const first = pages.find((p) => p.role === "page") ?? pages[0];
    return {
      width: first?.width || 800,
      height: first?.height || 1130,
    };
  }, [pages]);

  const pageSize = useMemo(() => {
    if (stageSize.w < 40 || stageSize.h < 40) {
      return { width: 280, height: 400 };
    }
    return computeFlipbookPageSize({
      pageW: pageMeta.width,
      pageH: pageMeta.height,
      availW: stageSize.w * 0.92,
      availH: stageSize.h * 0.92,
      spread: false,
    });
  }, [stageSize, pageMeta]);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const measure = () => {
      setStageSize({ w: el.clientWidth, h: el.clientHeight });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    setLoadedSrc((prev) =>
      mergeLoadedWindow(prev, pages, pageIndex, resolveUrl),
    );
  }, [pageIndex, pages, resolveUrl]);

  useEffect(() => {
    if (!jumpFocusedRef.current) {
      setJumpDraft(String(pageIndex + 1));
    }
  }, [pageIndex]);

  const fullscreenActive = isFullscreen || cssFullscreen;

  const toggleFullscreen = useCallback(async () => {
    const root = rootRef.current;
    if (!root) return;
    try {
      if (!document.fullscreenElement) {
        await root.requestFullscreen();
        setIsFullscreen(true);
      } else {
        await document.exitFullscreen();
        setIsFullscreen(false);
      }
    } catch {
      setCssFullscreen((v) => !v);
    }
  }, []);

  useEffect(() => {
    const onFs = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  const goTo = useCallback(
    (next: number, dir: "next" | "prev") => {
      if (animatingRef.current) return;
      const clamped = Math.max(0, Math.min(total - 1, next));
      if (clamped === pageIndex) return;
      animatingRef.current = true;
      setAnimDir(dir);
      window.setTimeout(() => {
        setPageIndex(clamped);
        setAnimDir(null);
        animatingRef.current = false;
      }, 420);
    },
    [pageIndex, total],
  );

  const goPrev = useCallback(() => goTo(pageIndex - 1, "prev"), [goTo, pageIndex]);
  const goNext = useCallback(() => goTo(pageIndex + 1, "next"), [goTo, pageIndex]);
  const goStart = useCallback(() => goTo(0, "prev"), [goTo]);
  const goEnd = useCallback(() => goTo(total - 1, "next"), [goTo, total]);

  const goToPageNumber = (raw: string) => {
    const n = Math.floor(Number(raw));
    if (!Number.isFinite(n)) return;
    const idx = Math.max(0, Math.min(total - 1, n - 1));
    const dir = idx >= pageIndex ? "next" : "prev";
    goTo(idx, dir);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowUp" || e.key === "PageUp") {
        e.preventDefault();
        goPrev();
      } else if (e.key === "ArrowDown" || e.key === "PageDown") {
        e.preventDefault();
        goNext();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goNext, goPrev]);

  const current = pages[pageIndex];
  const under =
    pageIndex < total - 1 ? pages[pageIndex + 1] : null;

  const flipClass =
    animDir === "next"
      ? "prova-web-spiral-vp__leaf--out"
      : animDir === "prev"
        ? "prova-web-spiral-vp__leaf--in"
        : "";

  return (
    <div
      ref={rootRef}
      className={`prova-web-spiral-vp flex min-h-0 flex-1 flex-col overflow-hidden ${
        cssFullscreen ? "prova-web-spiral-vp--css-fs" : ""
      }`}
    >
      <div ref={stageRef} className="prova-web-spiral-vp__stage relative min-h-0 flex-1">
        <div
          className="prova-web-spiral-vp__book"
          style={{
            width: pageSize.width,
            height: pageSize.height,
          }}
        >
          {under && (
            <div className="prova-web-spiral-vp__under">
              <img
                src={loadedSrc[under.page] ?? resolveUrl(under)}
                alt=""
                draggable={false}
              />
            </div>
          )}
          {current && (
            <div className={`prova-web-spiral-vp__leaf ${flipClass}`}>
              <img
                src={loadedSrc[current.page] ?? resolveUrl(current)}
                alt={pageAlt(current, total)}
                draggable={false}
              />
            </div>
          )}
        </div>
        <p className="prova-web-spiral-vp__hint">
          Espiral no topo · use ↑↓ ou os botões para folhear
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-2 border-t border-sagra-border bg-white px-4 py-3 shadow-sm">
        <ToolbarButton onClick={goStart} disabled={pageIndex <= 0} label="Início">
          <ChevronsUp className="size-4" aria-hidden />
        </ToolbarButton>
        <ToolbarButton
          onClick={goPrev}
          disabled={pageIndex <= 0}
          label="Página anterior"
        >
          <ChevronUp className="size-4" aria-hidden />
        </ToolbarButton>

        <span className="hidden min-w-36 select-none text-center text-xs font-medium tabular-nums text-neutral-600 sm:inline">
          {pageLabel(current, pageIndex, total)}
        </span>

        <label className="flex items-center gap-1 text-xs text-neutral-600">
          <span className="sr-only sm:not-sr-only sm:inline">Ir para</span>
          <input
            ref={jumpInputRef}
            type="number"
            min={1}
            max={total}
            value={jumpDraft}
            onFocus={() => {
              jumpFocusedRef.current = true;
            }}
            onBlur={() => {
              jumpFocusedRef.current = false;
              goToPageNumber(jumpDraft);
            }}
            onChange={(e) => setJumpDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                goToPageNumber(jumpDraft);
                jumpInputRef.current?.blur();
              }
            }}
            className="w-14 rounded-md border border-sagra-border bg-white px-1.5 py-1 text-center text-xs tabular-nums text-neutral-800"
            aria-label="Ir para página"
          />
          <span className="tabular-nums text-neutral-400">/ {total}</span>
        </label>

        <ToolbarButton
          onClick={goNext}
          disabled={pageIndex >= total - 1}
          label="Próxima página"
        >
          <ChevronDown className="size-4" aria-hidden />
        </ToolbarButton>
        <ToolbarButton
          onClick={goEnd}
          disabled={pageIndex >= total - 1}
          label="Fim"
        >
          <ChevronsDown className="size-4" aria-hidden />
        </ToolbarButton>

        <span className="mx-1 hidden h-5 w-px bg-sagra-border sm:inline" aria-hidden />

        <ToolbarButton onClick={() => setZoomOpen(true)} label="Ampliar página">
          <ZoomIn className="size-4" aria-hidden />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => void toggleFullscreen()}
          label={fullscreenActive ? "Sair da tela cheia" : "Tela cheia"}
        >
          {fullscreenActive ? (
            <Minimize2 className="size-4" aria-hidden />
          ) : (
            <Maximize2 className="size-4" aria-hidden />
          )}
        </ToolbarButton>
      </div>

      {zoomOpen && current && (
        <div
          className="prova-web-zoom-backdrop"
          role="dialog"
          aria-label="Página ampliada"
          onClick={() => setZoomOpen(false)}
        >
          <img
            src={loadedSrc[current.page] ?? resolveUrl(current)}
            alt={pageAlt(current, total)}
            style={{ width: Math.min(current.width, 1200) }}
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
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

function pageLabel(
  page: ProvaWebPageMeta | undefined,
  pageIndex: number,
  total: number,
): string {
  if (!page) return "";
  if (page.role === "cover-front") return `Capa · ${total} páginas`;
  if (page.role === "cover-back") return `Contracapa · ${total} páginas`;
  return `Página ${pageIndex + 1} de ${total}`;
}

function pageAlt(page: ProvaWebPageMeta, total: number): string {
  if (page.blank) return "Página em branco";
  switch (page.role) {
    case "cover-front":
      return "Capa";
    case "cover-back":
      return "Contracapa";
    default:
      return `Página ${page.page} de ${total}`;
  }
}
