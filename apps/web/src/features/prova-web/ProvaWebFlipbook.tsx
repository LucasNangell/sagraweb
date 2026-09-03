import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  X,
  Maximize2,
  Minimize2,
  ZoomIn,
} from "lucide-react";
import { PageFlip } from "page-flip";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  provaWebPageUrl,
  type ProvaWebBookStructureInsert,
  type ProvaWebManifestBase,
  type ProvaWebPageMeta,
} from "@/api/provaWeb";

import {
  computeFlipbookPageSize,
  mergeLoadedWindow,
  seedLoadedWindow,
} from "./flipbookFit";
import { BOOK_EXTRA_KIND_LABELS } from "./provaWebBookExtras";
import { ProvaWebFoldMockup3D } from "./ProvaWebFoldMockup3D";
import {
  foldMockupFromSpecialTreatment,
  resolvedSpecialFoldLines,
  specialTreatmentPagePixels,
  specialTreatmentScale,
  verticalFoldPanels,
} from "./provaWebSpecialTreatment";
import { ProvaWebSpiralVerticalPager } from "./ProvaWebSpiralVerticalPager";
import { softenFlipbookPages } from "./softenFlipbookPages";
import { shouldUseVerticalSpiralPager } from "./spiralFlipMode";
import "./prova-web.css";

const SPECIAL_FOLD_ORBIT_DEG = { x: 0, y: 0 } as const;

/** Mantém a página pedida se ela estiver no spread; senão a da esquerda. */
function preferredSyncPage(
  visiblePages: ProvaWebPageMeta[],
  preferredPage?: number | null,
): number | null {
  if (!visiblePages.length) return null;
  const preferred = Number(preferredPage);
  if (
    Number.isFinite(preferred) &&
    preferred >= 1 &&
    visiblePages.some((p) => p.page === preferred)
  ) {
    return preferred;
  }
  return visiblePages[0]?.page ?? null;
}

interface ProvaWebFlipbookProps {
  ano: number;
  osId: number;
  manifest: ProvaWebManifestBase;
  /** Sobrescreve a URL das páginas (ex.: portal do cliente, com token). */
  buildPageUrl?: (page: number) => string;
  /** Overlay opcional por página (ex.: marcas do Análise Lab). */
  renderPageOverlay?: (
    page: ProvaWebPageMeta,
    size: { width: number; height: number },
  ) => ReactNode;
  /** Overlay no slot do estágio (ex.: balões fora da página). */
  renderStageOverlay?: (ctx: {
    visiblePages: ProvaWebPageMeta[];
    pageSize: { width: number; height: number };
    slotWidth: number;
    isSpread: boolean;
    flipping: boolean;
    gutterRight: number;
  }) => ReactNode;
  /** Reserva faixa à direita do palco (ex.: balões do Análise Lab). */
  stageGutterRight?: number;
  /**
   * Reserva proporcional em volta da página para overlays fora do papel
   * (sangria): reduz o preview e libera o overflow da página.
   */
  pageBleedFraction?: number;
  /** Navega para a página lógica (manifest.page) quando o nonce muda. */
  pageTarget?: { page: number; nonce: number } | null;
  /** Página lógica visível (esquerda do spread) após virar ou aplicar alvo. */
  onPageChange?: (page: number) => void;
}

export function ProvaWebFlipbook({
  ano,
  osId,
  manifest,
  buildPageUrl,
  renderPageOverlay,
  renderStageOverlay,
  stageGutterRight = 0,
  pageBleedFraction = 0,
  pageTarget,
  onPageChange,
}: ProvaWebFlipbookProps) {
  if (shouldUseVerticalSpiralPager(manifest)) {
    return (
      <ProvaWebSpiralVerticalPager
        ano={ano}
        osId={osId}
        manifest={manifest}
        buildPageUrl={buildPageUrl}
      />
    );
  }

  return (
    <ProvaWebFlipbookHorizontal
      ano={ano}
      osId={osId}
      manifest={manifest}
      buildPageUrl={buildPageUrl}
      renderPageOverlay={renderPageOverlay}
      renderStageOverlay={renderStageOverlay}
      stageGutterRight={stageGutterRight}
      pageBleedFraction={pageBleedFraction}
      pageTarget={pageTarget}
      onPageChange={onPageChange}
    />
  );
}

function ProvaWebFlipbookHorizontal({
  ano,
  osId,
  manifest,
  buildPageUrl,
  renderPageOverlay,
  renderStageOverlay,
  stageGutterRight = 0,
  pageBleedFraction = 0,
  pageTarget,
  onPageChange,
}: ProvaWebFlipbookProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const bookRef = useRef<HTMLDivElement>(null);
  const flipRef = useRef<PageFlip | null>(null);
  const jumpInputRef = useRef<HTMLInputElement>(null);
  const jumpFocusedRef = useRef(false);
  const pageIndexRef = useRef(0);

  const pages = manifest.pages;
  const total = pages.length;
  const cacheKey = manifest.cacheKey;

  const onPageChangeRef = useRef(onPageChange);
  onPageChangeRef.current = onPageChange;
  const pageTargetRef = useRef(pageTarget);
  pageTargetRef.current = pageTarget;

  const reportVisiblePage = useCallback(
    (idx: number, preferredPage?: number | null) => {
      const visible = resolveVisiblePages(pages, idx);
      const page = preferredSyncPage(visible, preferredPage);
      if (page != null) onPageChangeRef.current?.(page);
    },
    [pages],
  );

  const resolveUrl = useCallback(
    (page: ProvaWebPageMeta) => {
      if (buildPageUrl) {
        return buildPageUrl(page.page);
      }
      return provaWebPageUrl(ano, osId, page.page, cacheKey);
    },
    [ano, buildPageUrl, cacheKey, osId],
  );

  const [pageIndex, setPageIndex] = useState(0);
  const [zoomOpen, setZoomOpen] = useState(false);
  const [jumpDraft, setJumpDraft] = useState("1");
  const [loadedSrc, setLoadedSrc] = useState<Record<number, string>>(() =>
    seedLoadedWindow(pages, 0, resolveUrl),
  );
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [cssFullscreen, setCssFullscreen] = useState(false);
  const [stageSize, setStageSize] = useState({ w: 0, h: 0 });
  const [flipping, setFlipping] = useState(false);
  const [isolatedSpecialPage, setIsolatedSpecialPage] =
    useState<ProvaWebPageMeta | null>(null);

  pageIndexRef.current = pageIndex;

  const pageUrl = resolveUrl;

  const visiblePages = useMemo(
    () => resolveVisiblePages(pages, pageIndex),
    [pages, pageIndex],
  );
  const activeSpecialPages = useMemo(
    () =>
      visiblePages
        .map((page, idx) => ({
          page,
          side: visiblePages.length === 1 ? "single" : idx === 0 ? "left" : "right",
        }))
        .filter((item): item is { page: ProvaWebPageMeta; side: "single" | "left" | "right" } =>
          Boolean(item.page.specialTreatment),
        ),
    [visiblePages],
  );
  const isSpread = visiblePages.length > 1;

  const pageMeta = useMemo(() => {
    const first = pages.find((p) => p.role === "page") ?? pages[0];
    return {
      width: first?.width || 800,
      height: first?.height || 1130,
      widthPt: first?.widthPt || 0,
      heightPt: first?.heightPt || 0,
    };
  }, [pages]);
  const basePageMm = useMemo(() => {
    const widthMm = Number(manifest.bookStructure?.pageWidthMm);
    const heightMm = Number(manifest.bookStructure?.pageHeightMm);
    if (Number.isFinite(widthMm) && widthMm > 0 && Number.isFinite(heightMm) && heightMm > 0) {
      return { widthMm, heightMm };
    }
    return {
      widthMm: pointsToMm(pageMeta.widthPt),
      heightMm: pointsToMm(pageMeta.heightPt),
    };
  }, [manifest.bookStructure?.pageHeightMm, manifest.bookStructure?.pageWidthMm, pageMeta]);

  const baseSize = useMemo(() => {
    if (stageSize.w < 40 || stageSize.h < 40) {
      return { width: 280, height: 400 };
    }
    // Sempre contain do miolo (2p): capa e espelho compartilham a mesma geometria
    // → capa já cabe na metade direita sem salto ao abrir.
    return computeFlipbookPageSize({
      bleedFraction: pageBleedFraction,
      pageW: pageMeta.width,
      pageH: pageMeta.height,
      availW: stageSize.w,
      availH: stageSize.h,
      spread: true,
    });
  }, [stageSize, pageMeta, pageBleedFraction]);

  /** Slot e PageFlip sempre 2p: capa `showCover` na direita, virada soft em landscape. */
  const slotWidth = baseSize.width * 2;
  const bookWidth = slotWidth;

  // Medir estágio real (header/tabs/padding).
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const measure = () => {
      const padX = 32;
      const padY = 16;
      const gutter = Math.max(0, stageGutterRight || 0);
      setStageSize({
        w: Math.max(0, el.clientWidth - padX - gutter),
        h: Math.max(0, el.clientHeight - padY),
      });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [cssFullscreen, isFullscreen, stageGutterRight]);

  // Reset + seed quando o manifesto muda (evita wipe sem re-seed).
  useEffect(() => {
    setPageIndex(0);
    setJumpDraft("1");
    setLoadedSrc(seedLoadedWindow(pages, 0, pageUrl));
    // Só cacheKey: pages pode ser referência nova a cada fetch sem mudar conteúdo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheKey]);

  // Progressive sticky ao folhear.
  useEffect(() => {
    if (total === 0) return;
    setLoadedSrc((prev) => mergeLoadedWindow(prev, pages, pageIndex, pageUrl));
  }, [pageIndex, pageUrl, pages, total]);

  // Instancia PageFlip (fixed + autoSize off → nós controlamos o box).
  useEffect(() => {
    const el = bookRef.current;
    if (!el || total === 0 || stageSize.w < 40) {
      return;
    }

    const flip = new PageFlip(el, {
      width: baseSize.width,
      height: baseSize.height,
      size: "fixed",
      autoSize: false,
      minWidth: Math.round(baseSize.width / 4),
      maxWidth: baseSize.width * 2,
      minHeight: Math.round(baseSize.height / 4),
      maxHeight: baseSize.height * 2,
      showCover: true,
      usePortrait: false,
      maxShadowOpacity: 0.5,
      flippingTime: 600,
      mobileScrollSupport: false,
      showPageCorners: true,
      startPage: pageIndexRef.current,
    });

    flip.loadFromHTML(el.querySelectorAll<HTMLElement>(".prova-web-page"));
    softenFlipbookPages(flip);
    let alive = true;
    flip.on("flip", (e) => {
      if (!alive) return;
      const idx = Number(e.data);
      const safe = Number.isFinite(idx) ? idx : 0;
      setPageIndex(safe);
      reportVisiblePage(safe);
    });
    flip.on("changeState", (e) => {
      if (!alive) return;
      const state = String(e.data || "");
      setFlipping(state === "flipping" || state === "user_fold");
    });
    flipRef.current = flip;

    const target = pageTargetRef.current;
    if (target?.page) {
      const hit = pages.find((p) => p.page === target.page);
      const idx = hit
        ? pages.indexOf(hit)
        : Math.max(0, Math.min(total - 1, target.page - 1));
      if (idx !== pageIndexRef.current) {
        try {
          flip.turnToPage(idx);
        } catch {
          /* ignore */
        }
        setPageIndex(idx);
      }
      reportVisiblePage(idx, target.page);
    }

    return () => {
      alive = false;
      flipRef.current = null;
      try {
        flip.destroy();
      } catch {
        // instância já removida do DOM
      }
    };
    // Remonta só quando o conjunto de páginas muda; tamanho via update().
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manifest.cacheKey, total, stageSize.w > 0]);

  useEffect(() => {
    if (!pageTarget) return;
    const flip = flipRef.current;
    if (!flip) return;
    const hit = pages.find((p) => p.page === pageTarget.page);
    const idx = hit
      ? pages.indexOf(hit)
      : Math.max(0, Math.min(total - 1, pageTarget.page - 1));
    const visible = resolveVisiblePages(pages, pageIndexRef.current);
    if (visible.some((p) => p.page === pageTarget.page)) {
      reportVisiblePage(pageIndexRef.current, pageTarget.page);
      return;
    }
    try {
      flip.turnToPage(idx);
    } catch {
      /* ignore */
    }
    setPageIndex(idx);
    reportVisiblePage(idx, pageTarget.page);
  }, [pageTarget?.nonce, pageTarget?.page, pages, reportVisiblePage, total]);

  // Reaplica dimensões contain sem perder página; capa fica na metade direita do slot.
  useEffect(() => {
    const flip = flipRef.current;
    if (!flip) return;
    const settings = flip.getSettings();
    settings.width = baseSize.width;
    settings.height = baseSize.height;
    settings.maxWidth = baseSize.width * 2;
    settings.maxHeight = baseSize.height * 2;
    const parent = bookRef.current;
    if (parent) {
      const w = baseSize.width * 2;
      parent.style.minWidth = `${w}px`;
      parent.style.minHeight = `${baseSize.height}px`;
      parent.style.width = `${w}px`;
      parent.style.height = `${baseSize.height}px`;
      parent.style.maxWidth = `${w}px`;
      parent.style.margin = "0";
    }
    try {
      flip.update();
    } catch {
      // PageFlip ainda inicializando
    }
  }, [baseSize.width, baseSize.height]);

  // Sync jump field when not focused
  useEffect(() => {
    if (jumpFocusedRef.current) return;
    const visible = resolveVisiblePages(pages, pageIndex);
    const first = visible[0];
    if (first) {
      setJumpDraft(String(first.page));
    }
  }, [pageIndex, pages]);

  const goPrev = useCallback(() => flipRef.current?.flipPrev(), []);
  const goNext = useCallback(() => flipRef.current?.flipNext(), []);
  const goStart = useCallback(() => flipRef.current?.turnToPage(0), []);
  const goEnd = useCallback(() => {
    const flip = flipRef.current;
    if (flip) {
      flip.turnToPage(flip.getPageCount() - 1);
    }
  }, []);

  /** Scroll no estágio: baixo = próxima; debounce evita multi-flip no trackpad. */
  const lastWheelAtRef = useRef(0);
  const onStageWheel = useCallback(
    (event: React.WheelEvent) => {
      if (zoomOpen) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest?.("[data-analise-lab-balloon]")) return;
      event.preventDefault();
      if (Math.abs(event.deltaY) < 6) return;
      const now = performance.now();
      if (now - lastWheelAtRef.current < 320) return;
      lastWheelAtRef.current = now;
      if (event.deltaY > 0) {
        goNext();
      } else {
        goPrev();
      }
    },
    [goNext, goPrev, zoomOpen],
  );

  const goToPageNumber = useCallback(
    (raw: string) => {
      const n = Number.parseInt(raw, 10);
      if (!Number.isFinite(n) || total < 1) return;
      const pageMetaHit = pages.find((p) => p.page === n);
      const idx = pageMetaHit
        ? pages.indexOf(pageMetaHit)
        : Math.max(0, Math.min(total - 1, n - 1));
      flipRef.current?.turnToPage(idx);
      setJumpDraft(String(pages[idx]?.page ?? n));
    },
    [pages, total],
  );

  const exitCssFullscreen = useCallback(() => setCssFullscreen(false), []);

  const toggleFullscreen = useCallback(async () => {
    const el = rootRef.current;
    if (!el) return;

    if (document.fullscreenElement === el) {
      await document.exitFullscreen().catch(() => undefined);
      setIsFullscreen(false);
      return;
    }
    if (cssFullscreen) {
      setCssFullscreen(false);
      return;
    }

    try {
      if (el.requestFullscreen) {
        await el.requestFullscreen();
        setIsFullscreen(true);
        return;
      }
    } catch {
      // fallback CSS
    }
    setCssFullscreen(true);
  }, [cssFullscreen]);

  useEffect(() => {
    const onFs = () => {
      setIsFullscreen(document.fullscreenElement === rootRef.current);
    };
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (zoomOpen) {
        if (event.key === "Escape") {
          setZoomOpen(false);
        }
        return;
      }
      if (isolatedSpecialPage) {
        if (event.key === "Escape") {
          setIsolatedSpecialPage(null);
        }
        return;
      }
      if (event.key === "Escape" && cssFullscreen) {
        exitCssFullscreen();
        return;
      }
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
      } else if (event.key === "Home") {
        goStart();
      } else if (event.key === "End") {
        goEnd();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    cssFullscreen,
    exitCssFullscreen,
    goEnd,
    goNext,
    goPrev,
    goStart,
    isolatedSpecialPage,
    zoomOpen,
  ]);

  const fullscreenActive = isFullscreen || cssFullscreen;

  return (
    <div
      ref={rootRef}
      className={
        cssFullscreen
          ? "prova-web-flipbook-fs-fallback flex min-h-0 flex-1 flex-col bg-slate-200"
          : "flex min-h-0 flex-1 flex-col bg-slate-200/70"
      }
    >
      <div
        ref={stageRef}
        className="flex min-h-0 flex-1 items-center justify-center overflow-hidden px-4 py-2"
        style={{
          paddingRight: Math.max(16, 16 + Math.max(0, stageGutterRight || 0)),
        }}
        onWheel={onStageWheel}
      >
        {/* Slot 2p fixo: capa/contracapa na metade direita (sem salto ao abrir). */}
        <div
          className="relative flex shrink-0 items-center justify-end"
          style={{
            width: slotWidth,
            height: baseSize.height,
            maxWidth: "100%",
          }}
        >
          <div
            key={`book-${cacheKey ?? "x"}-${total}`}
            ref={bookRef}
            className="prova-web-book"
            style={{
              width: bookWidth,
              height: baseSize.height,
              margin: 0,
            }}
          >
            {pages.map((page) => {
              const src = loadedSrc[page.page];
              const specialTreatment = page.specialTreatment ?? null;
              return (
                <div
                  key={page.page}
                  className={pageClassName(pageBleedFraction, Boolean(specialTreatment))}
                  data-density="soft"
                >
                  {src ? (
                    <div className="relative h-full w-full">
                      {specialTreatment ? (
                        <SpecialPageRealSize
                          page={page}
                          treatment={specialTreatment}
                          src={src}
                          total={total}
                          basePixelSize={baseSize}
                          basePageMm={basePageMm}
                          renderPageOverlay={renderPageOverlay}
                        />
                      ) : (
                        <>
                          <img
                            src={src}
                            alt={pageAlt(page, total)}
                            loading="eager"
                            draggable={false}
                          />
                          {renderPageOverlay
                            ? renderPageOverlay(page, {
                                width: baseSize.width,
                                height: baseSize.height,
                              })
                            : null}
                        </>
                      )}
                    </div>
                  ) : (
                    <div
                      className="prova-web-page-placeholder"
                      aria-hidden
                    />
                  )}
                </div>
              );
            })}
          </div>
          {renderStageOverlay
            ? renderStageOverlay({
                visiblePages,
                pageSize: baseSize,
                slotWidth,
                isSpread,
                flipping,
                gutterRight: Math.max(0, stageGutterRight || 0),
              })
            : null}
          {activeSpecialPages.map(({ page, side }) => (
            <SpecialTreatmentStagePreview
              key={page.page}
              page={page}
              side={side}
              src={loadedSrc[page.page] ?? pageUrl(page)}
              onOpen={() => setIsolatedSpecialPage(page)}
            />
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-2 border-t border-sagra-border bg-white px-4 py-3 shadow-sm">
        <ToolbarButton onClick={goStart} disabled={pageIndex <= 0} label="Início">
          <ChevronsLeft className="size-4" aria-hidden />
        </ToolbarButton>
        <ToolbarButton
          onClick={goPrev}
          disabled={pageIndex <= 0}
          label="Página anterior"
        >
          <ChevronLeft className="size-4" aria-hidden />
        </ToolbarButton>

        <span className="hidden min-w-36 select-none text-center text-xs font-medium tabular-nums text-neutral-600 sm:inline">
          {spreadLabel(pages, pageIndex)}
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
          <ChevronRight className="size-4" aria-hidden />
        </ToolbarButton>
        <ToolbarButton
          onClick={goEnd}
          disabled={pageIndex >= total - 1}
          label="Fim"
        >
          <ChevronsRight className="size-4" aria-hidden />
        </ToolbarButton>

        <span className="mx-1 hidden h-5 w-px bg-sagra-border sm:inline" aria-hidden />

        <ToolbarButton onClick={() => setZoomOpen(true)} label="Ampliar páginas">
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

      {zoomOpen && (
        <div
          className="prova-web-zoom-backdrop"
          role="dialog"
          aria-label="Páginas ampliadas"
          onClick={() => setZoomOpen(false)}
        >
          <div
            className={
              visiblePages.length > 1
                ? "prova-web-zoom-spread"
                : "flex flex-wrap items-start justify-center gap-4"
            }
          >
            {visiblePages.map((page) => (
              <img
                key={page.page}
                src={loadedSrc[page.page] ?? pageUrl(page)}
                alt={pageAlt(page, total)}
                style={{ width: Math.min(page.width, 1200) }}
              />
            ))}
          </div>
        </div>
      )}
      {isolatedSpecialPage?.specialTreatment ? (
        <SpecialTreatmentIsolatedView
          page={isolatedSpecialPage}
          src={loadedSrc[isolatedSpecialPage.page] ?? pageUrl(isolatedSpecialPage)}
          allPages={pages}
          resolvePageUrl={(p) => loadedSrc[p.page] ?? pageUrl(p)}
          onClose={() => setIsolatedSpecialPage(null)}
        />
      ) : null}
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

function SpecialPageRealSize({
  page,
  treatment,
  src,
  total,
  basePixelSize,
  basePageMm,
  renderPageOverlay,
}: {
  page: ProvaWebPageMeta;
  treatment: ProvaWebBookStructureInsert;
  src: string;
  total: number;
  basePixelSize: { width: number; height: number };
  basePageMm: { widthMm: number; heightMm: number };
  renderPageOverlay?: ProvaWebFlipbookProps["renderPageOverlay"];
}) {
  const realSize = specialTreatmentPagePixels({
    treatment,
    basePixelSize,
    basePageMm,
  });
  return (
    <div
      className="prova-web-special-real-size"
      style={{ width: realSize.width, height: realSize.height }}
    >
      <img src={src} alt={pageAlt(page, total)} loading="eager" draggable={false} />
      {renderPageOverlay
        ? renderPageOverlay(page, { width: realSize.width, height: realSize.height })
        : null}
      <SpecialPageTreatmentMarks treatment={treatment} />
    </div>
  );
}

function pageClassName(pageBleedFraction: number, special: boolean): string {
  const classes = ["prova-web-page"];
  if (pageBleedFraction > 0) classes.push("prova-web-page--bleed");
  if (special) classes.push("prova-web-page--special");
  return classes.join(" ");
}

function SpecialPageTreatmentMarks({
  treatment,
}: {
  treatment: ProvaWebBookStructureInsert;
}) {
  const lines = resolvedSpecialFoldLines(treatment);
  return (
    <div className="prova-web-special-marks" data-kind={treatment.kind} aria-hidden>
      <FoldPanels treatment={treatment} className="prova-web-special-fold-panel" />
      <span className="prova-web-special-marks__badge">
        {BOOK_EXTRA_KIND_LABELS[treatment.kind]}
      </span>
      {lines.map((line, index) => (
        <FoldLine
          key={`${line.axis}-${line.positionMm}-${index}`}
          treatment={treatment}
          axis={line.axis}
          positionMm={line.positionMm}
          className="prova-web-special-fold-line"
        />
      ))}
    </div>
  );
}

function SpecialTreatmentStagePreview({
  page,
  side,
  src,
  onOpen,
}: {
  page: ProvaWebPageMeta;
  side: "single" | "left" | "right";
  src: string;
  onOpen: () => void;
}) {
  const treatment = page.specialTreatment;
  if (!treatment) return null;
  const lines = resolvedSpecialFoldLines(treatment);
  const scale = specialTreatmentScale(treatment);
  return (
    <button
      type="button"
      className={`prova-web-special-preview prova-web-special-preview--${side}`}
      onClick={onOpen}
      aria-label={`Visualizar ${treatment.label} isolado`}
    >
      <div className="prova-web-special-preview__header">
        <strong>{treatment.label}</strong>
        <span>
          {scale.width.toFixed(1)}×{scale.height.toFixed(1)} mm
        </span>
      </div>
      <div
        className="prova-web-special-preview__sheet"
        data-kind={treatment.kind}
        style={{ width: scale.previewWidth, height: scale.previewHeight }}
      >
        <img src={src} alt={`Prévia de ${treatment.label}`} draggable={false} />
        <FoldPanels treatment={treatment} className="prova-web-special-preview__panel" />
        {lines.map((line, index) => (
          <FoldLine
            key={`${line.axis}-${line.positionMm}-${index}`}
            treatment={treatment}
            axis={line.axis}
            positionMm={line.positionMm}
            className="prova-web-special-preview__fold-line"
          />
        ))}
      </div>
    </button>
  );
}

function SpecialTreatmentIsolatedView({
  page,
  src,
  allPages,
  resolvePageUrl,
  onClose,
}: {
  page: ProvaWebPageMeta;
  src: string;
  allPages: ProvaWebPageMeta[];
  resolvePageUrl: (page: ProvaWebPageMeta) => string;
  onClose: () => void;
}) {
  const treatment = page.specialTreatment;
  const foldMockup = useMemo(
    () => (treatment ? foldMockupFromSpecialTreatment(treatment) : null),
    [treatment],
  );
  const mockupPages = useMemo(() => {
    if (!treatment) return [page];
    const frontMeta =
      findSpecialSourcePage(
        allPages,
        treatment,
        treatment.sourcePageStart,
        page,
      ) ?? page;
    const front: ProvaWebPageMeta = { ...frontMeta, role: "sheet-front" };
    if (!treatment.hasVerso) return [front];
    const backMeta = findSpecialSourcePage(
      allPages,
      treatment,
      treatment.sourcePageEnd,
      frontMeta,
    );
    if (!backMeta || backMeta.page === frontMeta.page) return [front];
    return [front, { ...backMeta, role: "sheet-back" as const }];
  }, [allPages, page, treatment]);
  const mockupPageUrl = useCallback(
    (p: ProvaWebPageMeta) => resolvePageUrl(p),
    [resolvePageUrl],
  );
  if (!treatment) return null;
  const lines = resolvedSpecialFoldLines(treatment);
  const scale = specialTreatmentScale(treatment);
  const displayWidth = Math.min(1200, Math.max(320, 520 * scale.ratio));
  const displayHeight = displayWidth / scale.ratio;
  const useFold3d = Boolean(foldMockup);
  return (
    <div
      className={
        useFold3d
          ? "prova-web-special-isolated prova-web-special-isolated--fold3d"
          : "prova-web-special-isolated"
      }
      role="dialog"
      aria-modal="true"
      aria-label={treatment.label}
      onClick={onClose}
    >
      <div
        className={
          useFold3d
            ? "prova-web-special-isolated__panel prova-web-special-isolated__panel--fold3d"
            : "prova-web-special-isolated__panel"
        }
        onClick={(e) => e.stopPropagation()}
      >
        <div className="prova-web-special-isolated__header">
          <div>
            <strong>{treatment.label}</strong>
            <span>
              {BOOK_EXTRA_KIND_LABELS[treatment.kind]} · {scale.width.toFixed(1)}×
              {scale.height.toFixed(1)} mm
              {treatment.hasVerso ? " · frente+verso" : ""}
            </span>
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar">
            <X className="size-5" aria-hidden />
          </button>
        </div>
        {foldMockup ? (
          <div className="prova-web-special-isolated__stage">
            <ProvaWebFoldMockup3D
              pages={mockupPages}
              foldMockup={foldMockup}
              pageUrl={mockupPageUrl}
              initialOrbitDeg={SPECIAL_FOLD_ORBIT_DEG}
              maxPixelRatio={4}
              fitPadding={1.02}
            />
          </div>
        ) : (
          <div
            className="prova-web-special-isolated__sheet"
            data-kind={treatment.kind}
            style={{ width: displayWidth, height: displayHeight }}
          >
            <img src={src} alt={`Página ${page.page}`} draggable={false} />
            <FoldPanels treatment={treatment} className="prova-web-special-isolated__panel-fold" />
            {lines.map((line, index) => (
              <FoldLine
                key={`${line.axis}-${line.positionMm}-${index}`}
                treatment={treatment}
                axis={line.axis}
                positionMm={line.positionMm}
                className="prova-web-special-isolated__fold-line"
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function findSpecialSourcePage(
  pages: ProvaWebPageMeta[],
  treatment: ProvaWebBookStructureInsert,
  sourcePage: number,
  preferNear: ProvaWebPageMeta,
): ProvaWebPageMeta | null {
  if (!sourcePage) return null;
  const componenteWanted =
    treatment.sourceComponent === "capa"
      ? "Capa"
      : treatment.sourceComponent === "unico"
        ? "Arq. Único"
        : "Miolo";
  const matches = pages.filter(
    (p) =>
      p.sourcePage === sourcePage &&
      (!p.componente || p.componente === componenteWanted),
  );
  if (!matches.length) {
    return pages.find((p) => p.sourcePage === sourcePage) ?? null;
  }
  return (
    matches.find((p) => p.page === preferNear.page) ?? matches[0] ?? null
  );
}

function FoldPanels({
  treatment,
  className,
}: {
  treatment: ProvaWebBookStructureInsert;
  className: string;
}) {
  return (
    <>
      {verticalFoldPanels(treatment).map((panel) => (
        <span
          key={panel.index}
          className={`${className} ${className}--${panel.index % 2 === 0 ? "front" : "back"}`}
          style={{ left: `${panel.leftPct}%`, width: `${panel.widthPct}%` }}
        />
      ))}
    </>
  );
}

function FoldLine({
  treatment,
  axis,
  positionMm,
  className,
}: {
  treatment: ProvaWebBookStructureInsert;
  axis: "vertical" | "horizontal";
  positionMm: number;
  className: string;
}) {
  const pct =
    axis === "vertical"
      ? (positionMm / Math.max(1, treatment.widthMm)) * 100
      : (positionMm / Math.max(1, treatment.heightMm)) * 100;
  return (
    <span
      className={
        axis === "vertical"
          ? `${className} ${className}--v`
          : `${className} ${className}--h`
      }
      style={axis === "vertical" ? { left: `${pct}%` } : { top: `${pct}%` }}
    />
  );
}

/** Páginas visíveis no spread atual (capa sozinha; miolo em pares). */
function resolveVisiblePages(
  pages: ProvaWebPageMeta[],
  pageIndex: number,
): ProvaWebPageMeta[] {
  const total = pages.length;
  if (total === 0) {
    return [];
  }
  if (pageIndex <= 0) {
    return [pages[0]];
  }
  if (pageIndex >= total - 1) {
    return [pages[total - 1]];
  }
  const left = pageIndex % 2 === 1 ? pageIndex : pageIndex - 1;
  return pages.slice(left, Math.min(left + 2, total - 1));
}

function spreadLabel(pages: ProvaWebPageMeta[], pageIndex: number): string {
  const total = pages.length;
  if (total === 0) {
    return "";
  }
  const visible = resolveVisiblePages(pages, pageIndex);
  const first = visible[0];
  const last = visible[visible.length - 1];
  if (first.role === "cover-front" && visible.length === 1) {
    return `Capa · ${total} páginas`;
  }
  if (last.role === "cover-back" && visible.length === 1) {
    return `Contracapa · ${total} páginas`;
  }
  if (visible.length === 2) {
    return `Páginas ${first.page}–${last.page} de ${total}`;
  }
  return `Página ${first.page} de ${total}`;
}

function pageAlt(page: ProvaWebPageMeta, total: number): string {
  if (page.blank) {
    return "Página em branco";
  }
  switch (page.role) {
    case "cover-front":
      return "Capa";
    case "cover-front-inside":
      return "Verso da capa";
    case "cover-back-inside":
      return "Verso da contracapa";
    case "cover-back":
      return "Contracapa";
    default:
      return `Página ${page.page} de ${total}`;
  }
}

function pointsToMm(value: number) {
  return Math.max(1, (Math.max(1, value) * 25.4) / 72);
}
