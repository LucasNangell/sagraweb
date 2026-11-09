import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type SyntheticEvent,
  type WheelEvent,
} from "react";

import { pdfCompareAssetUrl } from "./api";
import type { ComparePage, ViewMode } from "./types";

interface OsPdfCompareViewerProps {
  pages: ComparePage[];
  pageIndex: number;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  previousName?: string | null;
  currentName?: string | null;
}

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
  viewMode,
  onViewModeChange,
  previousName = null,
  currentName = null,
}: OsPdfCompareViewerProps) {
  const [zoom, setZoom] = useState(1);
  const [flickerShowB, setFlickerShowB] = useState(false);
  const [fitScale, setFitScale] = useState(1);
  const [naturalSize, setNaturalSize] = useState({ w: 0, h: 0 });
  const viewportRef = useRef<HTMLDivElement | null>(null);

  const page = pages.find((p) => p.index === pageIndex) || pages[0] || null;
  const isZoomed = zoom > 1.001;

  useEffect(() => {
    setZoom(1);
    if (page?.width && page?.height) {
      setNaturalSize({ w: page.width, h: page.height });
    } else {
      setNaturalSize({ w: 0, h: 0 });
    }
  }, [page, pageIndex, viewMode]);

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
    return pageImageUrl(page, viewMode);
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
      const availW = Math.max(1, el.clientWidth - pad);
      const availH = Math.max(1, el.clientHeight - pad);
      const next = Math.min(availW / contentSize.w, availH / contentSize.h);
      setFitScale(Number(Math.max(0.05, next).toFixed(4)));
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [contentSize.h, contentSize.w]);

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

  function changeMode(mode: ViewMode) {
    onViewModeChange(mode);
    setFlickerShowB(false);
    setZoom(1);
  }

  if (!page) {
    return <div className="os-pdf-viewer-empty">Sem páginas para exibir.</div>;
  }

  const displayScale = fitScale * zoom;
  const imgW = naturalSize.w ? naturalSize.w * displayScale : undefined;
  const imgH = naturalSize.h ? naturalSize.h * displayScale : undefined;
  const stageW = contentSize.w ? contentSize.w * displayScale : undefined;
  const stageH = contentSize.h ? contentSize.h * displayScale : undefined;

  return (
    <div className="os-pdf-viewer">
      <div className="os-pdf-toolbar">
        <div className="os-pdf-modes">
          {(
            [
              ["diff", "Diferença"],
              ["blend", "Sobreposição"],
              ["flicker", "Alternar"],
              ["side", "Lado a lado"],
            ] as const
          ).map(([mode, label]) => (
            <button
              key={mode}
              type="button"
              className={viewMode === mode ? "active" : ""}
              onClick={() => changeMode(mode)}
            >
              {label}
            </button>
          ))}
        </div>
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
        <div className="os-pdf-page-meta">
          Página {page.pageNumber} · {fmtPct(page.changedPercent)} ·{" "}
          {page.boxes?.length ?? 0} regiões
        </div>
      </div>

      <div
        ref={viewportRef}
        className={
          "os-pdf-viewport" + (isZoomed ? " is-zoomed" : " is-fitted")
        }
        onWheel={onWheel}
      >
        <div
          className="os-pdf-stage"
          style={{
            width: stageW,
            height: stageH,
          }}
        >
          {viewMode === "side" ? (
            <div className="os-pdf-side" style={{ width: stageW, height: stageH }}>
              <figure>
                <figcaption>Anterior</figcaption>
                {pageImageUrl(page, "previous") ? (
                  <img
                    src={pageImageUrl(page, "previous")!}
                    alt="Anterior"
                    onLoad={onImageLoad}
                    style={{ width: imgW, height: imgH }}
                  />
                ) : null}
              </figure>
              <figure>
                <figcaption>Atual</figcaption>
                {pageImageUrl(page, "current") ? (
                  <img
                    src={pageImageUrl(page, "current")!}
                    alt="Atual"
                    style={{ width: imgW, height: imgH }}
                  />
                ) : null}
              </figure>
            </div>
          ) : (
            <div className="os-pdf-main">
              {viewMode === "flicker" && (
                <span className="os-pdf-flicker-tag">
                  {flickerShowB ? "Atual" : "Anterior"}
                </span>
              )}
              {mainUrl ? (
                <img
                  src={mainUrl}
                  alt="Comparação"
                  draggable={false}
                  onLoad={onImageLoad}
                  style={{ width: imgW, height: imgH }}
                />
              ) : null}
            </div>
          )}
        </div>
      </div>

      <div className="os-pdf-legend" aria-label="Legenda da comparação">
        <div className="os-pdf-legend-files">
          <span className="os-pdf-legend-chip prev" title={previousName || undefined}>
            <span className="os-pdf-legend-key">A</span>
            Anterior: {previousName || "—"}
          </span>
          <span className="os-pdf-legend-chip curr" title={currentName || undefined}>
            <span className="os-pdf-legend-key">B</span>
            Atual: {currentName || "—"}
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
