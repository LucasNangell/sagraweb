import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type SyntheticEvent,
  type WheelEvent,
} from "react";

import { pdfCompareAssetUrl } from "./api";
import {
  OsPdfCompareRulers,
  type GuideLine,
} from "./OsPdfCompareRulers";
import type { ComparePage, ViewMode } from "./types";

interface OsPdfCompareViewerProps {
  pages: ComparePage[];
  pageIndex: number;
  onPageIndexChange: (index: number) => void;
  viewMode: ViewMode;
  previousName?: string | null;
  currentName?: string | null;
  changedPages?: number;
  dpi?: number;
}

const RULER_CHROME_X = 28;
const RULER_CHROME_Y = 28;
const GUIDE_EDITOR_H = 0;

function modeLegend(mode: ViewMode): { swatch: string; label: string }[] {
  switch (mode) {
    case "diff":
      return [
        { swatch: "diff-red", label: "Vermelho = pixels alterados" },
        { swatch: "diff-grey", label: "Cinza = áreas iguais" },
        { swatch: "diff-box", label: "Caixa laranja = região detectada" },
      ];
    case "blend":
      return [
        { swatch: "blend-cyan", label: "Ciano = versão anterior" },
        { swatch: "blend-magenta", label: "Magenta = versão atual" },
        { swatch: "blend-grey", label: "Cinza = áreas iguais" },
      ];
    case "flicker":
      return [
        { swatch: "prev", label: "Alterna anterior ↔ atual" },
      ];
    case "side":
      return [
        { swatch: "prev", label: "Esquerda = anterior" },
        { swatch: "curr", label: "Direita = atual" },
      ];
    case "previous":
      return [{ swatch: "prev", label: "Exibe somente a versão anterior" }];
    case "current":
      return [{ swatch: "curr", label: "Exibe somente a versão atual" }];
    default:
      return [];
  }
}

function fmtPct(n: number): string {
  if (!Number.isFinite(n)) return "0%";
  if (n < 0.01) return "0%";
  if (n < 1) return `${n.toFixed(2)}%`;
  return `${n.toFixed(1)}%`;
}

function fmtMm(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const rounded = Math.round(n * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2);
}

function pageSizeMmLabel(
  widthPx: number,
  heightPx: number,
  dpi: number,
): string | null {
  if (!widthPx || !heightPx || !dpi) return null;
  const w = (widthPx / dpi) * 25.4;
  const h = (heightPx / dpi) * 25.4;
  return `${fmtMm(w)} × ${fmtMm(h)} mm`;
}

function pageImageUrl(
  page: ComparePage,
  mode: "diff" | "blend" | "previous" | "current",
): string | null {
  const urls = page.urls || {};
  if (mode === "previous") return pdfCompareAssetUrl(urls.a);
  if (mode === "current") return pdfCompareAssetUrl(urls.b);
  if (mode === "blend") return pdfCompareAssetUrl(urls.blend);
  return pdfCompareAssetUrl(urls.diff);
}

export function OsPdfCompareViewer({
  pages,
  pageIndex,
  onPageIndexChange,
  viewMode,
  previousName = null,
  currentName = null,
  changedPages = 0,
  dpi = 150,
}: OsPdfCompareViewerProps) {
  const [zoom, setZoom] = useState(1);
  const [flickerShowB, setFlickerShowB] = useState(false);
  const [fitScale, setFitScale] = useState(1);
  const [naturalSize, setNaturalSize] = useState({ w: 0, h: 0 });
  const [guides, setGuides] = useState<GuideLine[]>([]);
  const viewportRef = useRef<HTMLDivElement | null>(null);

  const page = pages.find((p) => p.index === pageIndex) || pages[0] || null;
  const isZoomed = zoom > 1.001;
  const showRulers = viewMode !== "side";
  const pageOrder = useMemo(() => pages.map((p) => p.index), [pages]);
  const orderPos = pageOrder.indexOf(pageIndex);
  const canGoPrev = orderPos > 0;
  const canGoNext = orderPos >= 0 && orderPos < pageOrder.length - 1;

  const goPrevPage = useCallback(() => {
    if (!canGoPrev) return;
    onPageIndexChange(pageOrder[orderPos - 1]);
  }, [canGoPrev, onPageIndexChange, orderPos, pageOrder]);

  const goNextPage = useCallback(() => {
    if (!canGoNext) return;
    onPageIndexChange(pageOrder[orderPos + 1]);
  }, [canGoNext, onPageIndexChange, orderPos, pageOrder]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        goPrevPage();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        goNextPage();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [goNextPage, goPrevPage]);

  useEffect(() => {
    setZoom(1);
    if (page?.width && page?.height) {
      setNaturalSize({ w: page.width, h: page.height });
    } else {
      setNaturalSize({ w: 0, h: 0 });
    }
  }, [page, pageIndex]);

  useEffect(() => {
    setZoom(1);
  }, [viewMode]);

  useEffect(() => {
    if (viewMode !== "flicker") return;
    const id = window.setInterval(() => setFlickerShowB((v) => !v), 450);
    return () => window.clearInterval(id);
  }, [viewMode]);

  const mainUrl = useMemo(() => {
    if (!page) return null;
    if (viewMode === "flicker") {
      return pageImageUrl(page, flickerShowB ? "current" : "previous");
    }
    if (viewMode === "side") return null;
    if (viewMode === "previous" || viewMode === "current") {
      return pageImageUrl(page, viewMode);
    }
    if (viewMode === "blend") return pageImageUrl(page, "blend");
    return pageImageUrl(page, "diff");
  }, [page, viewMode, flickerShowB]);

  const contentSize = useMemo(() => {
    if (!naturalSize.w || !naturalSize.h) return { w: 0, h: 0 };
    if (viewMode === "side") {
      const gap = 12;
      const caption = 18;
      return {
        w: naturalSize.w * 2 + gap,
        h: naturalSize.h + caption,
      };
    }
    return naturalSize;
  }, [naturalSize, viewMode]);

  useLayoutEffect(() => {
    const el = viewportRef.current;
    if (!el || !contentSize.w || !contentSize.h) return;

    const measure = () => {
      const pad = 8;
      const chromeX = showRulers ? RULER_CHROME_X : 0;
      const chromeY = showRulers ? RULER_CHROME_Y + GUIDE_EDITOR_H : 0;
      const availW = Math.max(1, el.clientWidth - pad - chromeX);
      const availH = Math.max(1, el.clientHeight - pad - chromeY);
      const next = Math.min(availW / contentSize.w, availH / contentSize.h);
      setFitScale(Number(Math.max(0.05, next).toFixed(4)));
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [contentSize.h, contentSize.w, showRulers]);

  function onImageLoad(e: SyntheticEvent<HTMLImageElement>) {
    const img = e.currentTarget;
    if (!img.naturalWidth || !img.naturalHeight) return;
    setNaturalSize({ w: img.naturalWidth, h: img.naturalHeight });
  }

  function onWheel(e: WheelEvent<HTMLDivElement>) {
    if (!e.ctrlKey && !e.metaKey) {
      if (!isZoomed) e.preventDefault();
      return;
    }
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    setZoom((z) => Math.min(8, Math.max(1, Number((z * factor).toFixed(3)))));
  }

  function fitZoom() {
    setZoom(1);
  }

  if (!page) {
    return <div className="os-pdf-viewer-empty">Sem páginas para exibir.</div>;
  }

  const displayScale = fitScale * zoom;
  const imgW = naturalSize.w ? naturalSize.w * displayScale : 0;
  const imgH = naturalSize.h ? naturalSize.h * displayScale : 0;
  const stageW = contentSize.w ? contentSize.w * displayScale : 0;
  const stageH = contentSize.h ? contentSize.h * displayScale : 0;
  const pageSizeLabel = page
    ? pageSizeMmLabel(page.width, page.height, dpi)
    : null;

  const pageBody = viewMode === "side" ? (
    <div className="os-pdf-side" style={{ width: stageW || undefined, height: stageH || undefined }}>
      <figure>
        <figcaption>Anterior</figcaption>
        {pageImageUrl(page, "previous") ? (
          <img
            src={pageImageUrl(page, "previous")!}
            alt="Anterior"
            onLoad={onImageLoad}
            style={{ width: imgW || undefined, height: imgH || undefined }}
          />
        ) : null}
      </figure>
      <figure>
        <figcaption>Atual</figcaption>
        {pageImageUrl(page, "current") ? (
          <img
            src={pageImageUrl(page, "current")!}
            alt="Atual"
            style={{ width: imgW || undefined, height: imgH || undefined }}
          />
        ) : null}
      </figure>
    </div>
  ) : (
    <div className="os-pdf-main">
      {(viewMode === "flicker" ||
        viewMode === "previous" ||
        viewMode === "current") && (
        <span className="os-pdf-flicker-tag">
          {viewMode === "previous"
            ? "Anterior"
            : viewMode === "current"
              ? "Atual"
              : flickerShowB
                ? "Atual"
                : "Anterior"}
        </span>
      )}
      {mainUrl ? (
        <img
          src={mainUrl}
          alt="Comparação"
          draggable={false}
          onLoad={onImageLoad}
          style={{ width: imgW || undefined, height: imgH || undefined }}
        />
      ) : null}
    </div>
  );

  return (
    <div className="os-pdf-viewer">
      <div className="os-pdf-toolbar">
        <div className="os-pdf-zoom">
          <button
            type="button"
            onClick={() => setZoom((z) => Math.min(8, Number((z * 1.15).toFixed(3))))}
          >
            +
          </button>
          <button
            type="button"
            onClick={() => setZoom((z) => Math.max(1, Number((z / 1.15).toFixed(3))))}
          >
            −
          </button>
          <button type="button" onClick={fitZoom}>
            Ajustar
          </button>
          <span>{Math.round(zoom * 100)}%</span>
        </div>
        <div className="os-pdf-toolbar-right">
          <span
            className={
              "os-pdf-changed-badge" +
              (changedPages > 0 ? " has-changes" : " no-changes")
            }
          >
            {changedPages} página{changedPages === 1 ? "" : "s"} alterada
            {changedPages === 1 ? "" : "s"}
          </span>
          <div className="os-pdf-page-meta">
            Página {page.pageNumber} · {fmtPct(page.changedPercent)} ·{" "}
            {page.boxes?.length ?? 0} regiões
          </div>
        </div>
      </div>

      <div className="os-pdf-viewport-shell">
        <button
          type="button"
          className="os-pdf-page-nav prev"
          onClick={goPrevPage}
          disabled={!canGoPrev}
          title="Página anterior (←)"
          aria-label="Página anterior"
        >
          <ChevronLeft className="size-5" aria-hidden />
        </button>

        <div
          ref={viewportRef}
          className={
            "os-pdf-viewport" + (isZoomed ? " is-zoomed" : " is-fitted")
          }
          onWheel={onWheel}
        >
          <div className="os-pdf-stage">
            {showRulers && imgW > 0 && imgH > 0 ? (
              <OsPdfCompareRulers
                pageWidthPx={naturalSize.w}
                pageHeightPx={naturalSize.h}
                displayWidth={imgW}
                displayHeight={imgH}
                dpi={dpi}
                pageIndex={pageIndex}
                guides={guides}
                onGuidesChange={setGuides}
              >
                {pageBody}
              </OsPdfCompareRulers>
            ) : (
              pageBody
            )}
          </div>
        </div>

        <button
          type="button"
          className="os-pdf-page-nav next"
          onClick={goNextPage}
          disabled={!canGoNext}
          title="Próxima página (→)"
          aria-label="Próxima página"
        >
          <ChevronRight className="size-5" aria-hidden />
        </button>
      </div>

      <div className="os-pdf-legend" aria-label="Legenda da comparação">
        <div className="os-pdf-legend-files">
          <span
            className="os-pdf-legend-chip prev"
            title={
              previousName
                ? `${previousName}${pageSizeLabel ? ` · ${pageSizeLabel}` : ""}`
                : undefined
            }
          >
            <span className="os-pdf-legend-key">A</span>
            <span className="os-pdf-legend-chip-text">
              Anterior: {previousName || "—"}
              {pageSizeLabel ? (
                <span className="os-pdf-legend-size">{pageSizeLabel}</span>
              ) : null}
            </span>
          </span>
          <span
            className="os-pdf-legend-chip curr"
            title={
              currentName
                ? `${currentName}${pageSizeLabel ? ` · ${pageSizeLabel}` : ""}`
                : undefined
            }
          >
            <span className="os-pdf-legend-key">B</span>
            <span className="os-pdf-legend-chip-text">
              Atual: {currentName || "—"}
              {pageSizeLabel ? (
                <span className="os-pdf-legend-size">{pageSizeLabel}</span>
              ) : null}
            </span>
          </span>
        </div>
        <div className="os-pdf-legend-mode">
          {modeLegend(viewMode).map((item) => (
            <span key={item.label} className="os-pdf-legend-item">
              <span
                className={`os-pdf-legend-swatch ${item.swatch}`}
                aria-hidden
              />
              {item.label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
