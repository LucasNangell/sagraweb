import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
  type WheelEvent,
} from "react";

import { pdfCompareAssetUrl } from "./api";
import type { ComparePage, ViewMode } from "./types";

interface OsPdfCompareViewerProps {
  pages: ComparePage[];
  pageIndex: number;
  onPageIndexChange: (index: number) => void;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
}

function severityClass(page: ComparePage): string {
  if (page.status !== "compared") return "sev-critical";
  if (page.changedPercent <= 0.01) return "sev-none";
  if (page.changedPercent < 0.5) return "sev-low";
  if (page.changedPercent < 2) return "sev-mid";
  return "sev-high";
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
  onPageIndexChange,
  viewMode,
  onViewModeChange,
}: OsPdfCompareViewerProps) {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [flickerShowB, setFlickerShowB] = useState(false);
  const dragRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(
    null,
  );

  const page = pages.find((p) => p.index === pageIndex) || pages[0] || null;

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

  function onWheel(e: WheelEvent<HTMLDivElement>) {
    // Zoom só com Ctrl/Cmd; sem modificador deixa o scroll nativo da área.
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    setZoom((z) => Math.min(8, Math.max(0.2, Number((z * factor).toFixed(3)))));
  }

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    dragRef.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
  }

  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    if (!dragRef.current) return;
    setPan({
      x: dragRef.current.panX + (e.clientX - dragRef.current.x),
      y: dragRef.current.panY + (e.clientY - dragRef.current.y),
    });
  }

  function onPointerUp() {
    dragRef.current = null;
  }

  function fitZoom() {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }

  function changeMode(mode: ViewMode) {
    onViewModeChange(mode);
    setFlickerShowB(false);
    setPan({ x: 0, y: 0 });
  }

  if (!page) {
    return <div className="os-pdf-viewer-empty">Sem páginas para exibir.</div>;
  }

  return (
    <div className="os-pdf-viewer">
      <div className="os-pdf-thumbs">
        {pages.map((p) => {
          const thumb = pdfCompareAssetUrl(p.urls.thumb);
          return (
            <button
              key={p.index}
              type="button"
              className={
                "os-pdf-thumb " +
                severityClass(p) +
                (p.index === page.index ? " active" : "")
              }
              onClick={() => {
                onPageIndexChange(p.index);
                fitZoom();
              }}
            >
              {thumb ? <img src={thumb} alt={`Pág. ${p.pageNumber}`} /> : null}
              <span>
                {p.pageNumber} · {fmtPct(p.changedPercent)}
              </span>
            </button>
          );
        })}
      </div>

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
          <button type="button" onClick={() => setZoom((z) => Math.min(8, z * 1.15))}>
            +
          </button>
          <button type="button" onClick={() => setZoom((z) => Math.max(0.2, z / 1.15))}>
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
        className="os-pdf-viewport"
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div
          className="os-pdf-stage"
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          }}
        >
          {viewMode === "side" ? (
            <div className="os-pdf-side">
              <figure>
                <figcaption>Anterior</figcaption>
                {pageImageUrl(page, "previous") ? (
                  <img src={pageImageUrl(page, "previous")!} alt="Anterior" />
                ) : null}
              </figure>
              <figure>
                <figcaption>Atual</figcaption>
                {pageImageUrl(page, "current") ? (
                  <img src={pageImageUrl(page, "current")!} alt="Atual" />
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
              {mainUrl ? <img src={mainUrl} alt="Comparação" draggable={false} /> : null}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
