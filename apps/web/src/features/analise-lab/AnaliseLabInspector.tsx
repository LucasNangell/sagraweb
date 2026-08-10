import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";

import type { AnaliseLabMark, AnaliseLabMarkCor } from "@/api/analiseLab";
import type { ProvaWebPageMeta } from "@/api/provaWeb";

import { AnaliseLabMarksLayer } from "./AnaliseLabMarksLayer";
import type { AnaliseLabTool } from "./AnaliseLabMarkTools";
import { distanceMm, formatMm, pageSizeMm } from "./analiseLabGeometry";

interface AnaliseLabInspectorProps {
  pages: ProvaWebPageMeta[];
  pageIndex: number;
  onPageIndexChange: (index: number) => void;
  resolveUrl: (page: number) => string;
  marks: AnaliseLabMark[];
  tool: AnaliseLabTool;
  applyAllPages: boolean;
  cor: AnaliseLabMarkCor;
  rotulo: string;
  selectedMarkId?: number | null;
  onCreateGeometryMark: (args: {
    tipo: "ponto" | "retangulo" | "medida";
    geometria: Record<string, number>;
  }) => void;
}

export function AnaliseLabInspector({
  pages,
  pageIndex,
  onPageIndexChange,
  resolveUrl,
  marks,
  tool,
  applyAllPages: _applyAllPages,
  cor: _cor,
  rotulo: _rotulo,
  selectedMarkId = null,
  onCreateGeometryMark,
}: AnaliseLabInspectorProps) {
  const imgRef = useRef<HTMLImageElement>(null);
  const [zoom, setZoom] = useState(1);
  const [draft, setDraft] = useState<{ xMm: number; yMm: number } | null>(null);
  const [hoverMm, setHoverMm] = useState<{ x: number; y: number } | null>(null);

  const page = pages[pageIndex];
  const { widthMm, heightMm } = useMemo(
    () => pageSizeMm(page?.widthPt || 0, page?.heightPt || 0),
    [page?.widthPt, page?.heightPt],
  );

  const displayW = Math.round((page?.width || 800) * zoom);
  const displayH = Math.round((page?.height || 1130) * zoom);

  const toMm = (clientX: number, clientY: number) => {
    const el = imgRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const xPx = clientX - rect.left;
    const yPx = clientY - rect.top;
    const xMm = (xPx / Math.max(1, rect.width)) * widthMm;
    const yMm = (yPx / Math.max(1, rect.height)) * heightMm;
    return {
      xMm: Math.max(0, Math.min(widthMm, xMm)),
      yMm: Math.max(0, Math.min(heightMm, yMm)),
    };
  };

  const handleClick = (e: React.MouseEvent) => {
    if (
      tool === "select" ||
      tool === "offset_corte" ||
      tool === "faixa" ||
      tool === "grade"
    ) {
      return;
    }
    const pt = toMm(e.clientX, e.clientY);
    if (!pt) return;

    if (tool === "ponto") {
      onCreateGeometryMark({
        tipo: "ponto",
        geometria: { xMm: pt.xMm, yMm: pt.yMm },
      });
      return;
    }

    if (!draft) {
      setDraft(pt);
      return;
    }

    if (tool === "medida") {
      onCreateGeometryMark({
        tipo: "medida",
        geometria: {
          x1Mm: draft.xMm,
          y1Mm: draft.yMm,
          x2Mm: pt.xMm,
          y2Mm: pt.yMm,
        },
      });
      setDraft(null);
      return;
    }

    if (tool === "retangulo") {
      const xMm = Math.min(draft.xMm, pt.xMm);
      const yMm = Math.min(draft.yMm, pt.yMm);
      const wMm = Math.abs(pt.xMm - draft.xMm);
      const hMm = Math.abs(pt.yMm - draft.yMm);
      if (wMm > 0.2 && hMm > 0.2) {
        onCreateGeometryMark({
          tipo: "retangulo",
          geometria: { xMm, yMm, wMm, hMm },
        });
      }
      setDraft(null);
    }
  };

  if (!page) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-neutral-500">
        Sem páginas renderizadas.
      </div>
    );
  }

  const liveLabel =
    draft && hoverMm && (tool === "medida" || tool === "retangulo")
      ? tool === "medida"
        ? formatMm(
            distanceMm(draft.xMm, draft.yMm, hoverMm.x, hoverMm.y),
          )
        : `${formatMm(Math.abs(hoverMm.x - draft.xMm))} × ${formatMm(
            Math.abs(hoverMm.y - draft.yMm),
          )}`
      : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-slate-200/70">
      <div className="flex shrink-0 items-center justify-center gap-2 border-b border-sagra-border bg-white px-3 py-2">
        <button
          type="button"
          disabled={pageIndex <= 0}
          onClick={() => onPageIndexChange(Math.max(0, pageIndex - 1))}
          className="rounded border border-sagra-border p-1.5 disabled:opacity-40"
        >
          <ChevronLeft className="size-4" aria-hidden />
        </button>
        <span className="tabular-nums text-xs text-neutral-700">
          Página {pageIndex + 1} / {pages.length}
        </span>
        <button
          type="button"
          disabled={pageIndex >= pages.length - 1}
          onClick={() =>
            onPageIndexChange(Math.min(pages.length - 1, pageIndex + 1))
          }
          className="rounded border border-sagra-border p-1.5 disabled:opacity-40"
        >
          <ChevronRight className="size-4" aria-hidden />
        </button>
        <button
          type="button"
          onClick={() => setZoom((z) => Math.max(0.4, z - 0.1))}
          className="rounded border border-sagra-border p-1.5"
        >
          <ZoomOut className="size-4" aria-hidden />
        </button>
        <button
          type="button"
          onClick={() => setZoom((z) => Math.min(3, z + 0.1))}
          className="rounded border border-sagra-border p-1.5"
        >
          <ZoomIn className="size-4" aria-hidden />
        </button>
        <span className="tabular-nums text-xs text-neutral-500">
          {Math.round(zoom * 100)}% · {formatMm(widthMm)} × {formatMm(heightMm)}
        </span>
        {hoverMm ? (
          <span className="tabular-nums text-xs text-neutral-500">
            ({formatMm(hoverMm.x)}, {formatMm(hoverMm.y)})
          </span>
        ) : null}
        {liveLabel ? (
          <span className="rounded bg-sky-100 px-1.5 py-0.5 text-xs font-semibold text-sky-800">
            {liveLabel}
          </span>
        ) : null}
      </div>

      <div className="relative min-h-0 flex-1 overflow-auto p-4">
        <div
          className="relative mx-auto bg-white shadow"
          style={{ width: displayW, height: displayH }}
          onClick={handleClick}
          onMouseMove={(e) => {
            const pt = toMm(e.clientX, e.clientY);
            if (pt) setHoverMm({ x: pt.xMm, y: pt.yMm });
          }}
          onMouseLeave={() => setHoverMm(null)}
        >
          <div
            className="pointer-events-none absolute -left-6 top-0 h-full w-6 border-r border-neutral-300 bg-neutral-100 text-[9px] text-neutral-500"
            aria-hidden
          >
            {Array.from({ length: Math.floor(heightMm / 10) + 1 }).map((_, i) => (
              <div
                key={`ry-${i}`}
                className="absolute right-0 border-t border-neutral-400 pr-0.5"
                style={{ top: `${(i * 10 * 100) / heightMm}%` }}
              >
                {i * 10}
              </div>
            ))}
          </div>
          <div
            className="pointer-events-none absolute -top-5 left-0 h-5 w-full border-b border-neutral-300 bg-neutral-100 text-[9px] text-neutral-500"
            aria-hidden
          >
            {Array.from({ length: Math.floor(widthMm / 10) + 1 }).map((_, i) => (
              <div
                key={`rx-${i}`}
                className="absolute bottom-0 border-l border-neutral-400 pl-0.5"
                style={{ left: `${(i * 10 * 100) / widthMm}%` }}
              >
                {i * 10}
              </div>
            ))}
          </div>

          <img
            ref={imgRef}
            src={resolveUrl(page.page)}
            alt={`Página ${page.page}`}
            className="block h-full w-full select-none"
            draggable={false}
          />
          <AnaliseLabMarksLayer
            marks={marks}
            pageNumber={page.page}
            pageWidthMm={widthMm}
            pageHeightMm={heightMm}
            displayWidth={displayW}
            displayHeight={displayH}
            includeMedidas
            selectedMarkId={selectedMarkId}
          />
          {draft && hoverMm && (tool === "medida" || tool === "retangulo") ? (
            <svg
              className="pointer-events-none absolute inset-0 h-full w-full"
              viewBox={`0 0 ${displayW} ${displayH}`}
              aria-hidden
            >
              {tool === "medida" ? (
                <>
                  <line
                    x1={(draft.xMm / widthMm) * displayW}
                    y1={(draft.yMm / heightMm) * displayH}
                    x2={(hoverMm.x / widthMm) * displayW}
                    y2={(hoverMm.y / heightMm) * displayH}
                    stroke="#0ea5e9"
                    strokeWidth={1.5}
                    strokeDasharray="4 3"
                  />
                  <text
                    x={
                      (((draft.xMm + hoverMm.x) / 2) / widthMm) * displayW + 4
                    }
                    y={
                      (((draft.yMm + hoverMm.y) / 2) / heightMm) * displayH - 4
                    }
                    fill="#0369a1"
                    fontSize={12}
                    fontWeight={600}
                  >
                    {formatMm(
                      distanceMm(draft.xMm, draft.yMm, hoverMm.x, hoverMm.y),
                    )}
                  </text>
                </>
              ) : (
                <rect
                  x={
                    (Math.min(draft.xMm, hoverMm.x) / widthMm) * displayW
                  }
                  y={
                    (Math.min(draft.yMm, hoverMm.y) / heightMm) * displayH
                  }
                  width={
                    (Math.abs(hoverMm.x - draft.xMm) / widthMm) * displayW
                  }
                  height={
                    (Math.abs(hoverMm.y - draft.yMm) / heightMm) * displayH
                  }
                  fill="rgba(14,165,233,0.15)"
                  stroke="#0ea5e9"
                  strokeWidth={1.5}
                  strokeDasharray="4 3"
                />
              )}
            </svg>
          ) : null}
          {draft ? (
            <div
              className="pointer-events-none absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-sky-500"
              style={{
                left: `${(draft.xMm / widthMm) * 100}%`,
                top: `${(draft.yMm / heightMm) * 100}%`,
              }}
            />
          ) : null}
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
