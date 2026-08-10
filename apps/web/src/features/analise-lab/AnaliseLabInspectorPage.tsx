import { useRef, useState } from "react";

import type {
  AnaliseLabEdge,
  AnaliseLabMark,
  AnaliseLabMarkCor,
} from "@/api/analiseLab";
import type { ProvaWebPageMeta } from "@/api/provaWeb";

import { AnaliseLabMarksLayer } from "./AnaliseLabMarksLayer";
import type { AnaliseLabTool } from "./AnaliseLabMarkTools";
import {
  distanceMm,
  faixaFromDrag,
  formatMm,
  pageSizeMm,
} from "./analiseLabGeometry";

type RulerDrag = {
  axis: "x" | "y";
  startMm: number;
  currentMm: number;
};

type TextDraft = {
  xMm: number;
  yMm: number;
  value: string;
};

interface AnaliseLabInspectorPageProps {
  page: ProvaWebPageMeta;
  zoom: number;
  loadSrc: boolean;
  resolveUrl: (page: number) => string;
  marks: AnaliseLabMark[];
  tool: AnaliseLabTool;
  edge: AnaliseLabEdge;
  cor: AnaliseLabMarkCor;
  espessura: number;
  selectedMarkId?: number | null;
  showLeftRuler: boolean;
  interactive: boolean;
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

export function AnaliseLabInspectorPage({
  page,
  zoom,
  loadSrc,
  resolveUrl,
  marks,
  tool,
  edge,
  cor: _cor,
  espessura,
  selectedMarkId = null,
  showLeftRuler,
  interactive,
  onCreateGeometryMark,
  onCreateFaixaDrag,
}: AnaliseLabInspectorPageProps) {
  const imgRef = useRef<HTMLImageElement>(null);
  const [draft, setDraft] = useState<{ xMm: number; yMm: number } | null>(null);
  const [hoverMm, setHoverMm] = useState<{ x: number; y: number } | null>(null);
  const [rulerDrag, setRulerDrag] = useState<RulerDrag | null>(null);
  const [textDraft, setTextDraft] = useState<TextDraft | null>(null);
  const [freePoints, setFreePoints] = useState<number[][] | null>(null);

  const { widthMm, heightMm } = pageSizeMm(page.widthPt || 0, page.heightPt || 0);
  const displayW = Math.round((page.width || 800) * zoom);
  const displayH = Math.round((page.height || 1130) * zoom);

  const topRulerActive =
    interactive &&
    tool === "faixa" &&
    (edge === "left" || edge === "right" || edge === "all");
  const leftRulerActive =
    interactive &&
    showLeftRuler &&
    tool === "faixa" &&
    (edge === "top" || edge === "bottom" || edge === "all");

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
    if (!interactive || rulerDrag || freePoints) return;
    if (
      tool === "select" ||
      tool === "offset_corte" ||
      tool === "faixa" ||
      tool === "grade" ||
      tool === "livre"
    ) {
      return;
    }
    const pt = toMm(e.clientX, e.clientY);
    if (!pt) return;

    if (tool === "ponto") {
      onCreateGeometryMark({
        tipo: "ponto",
        geometria: { xMm: pt.xMm, yMm: pt.yMm },
        pagina: page.page,
      });
      return;
    }

    if (tool === "texto") {
      setTextDraft({ xMm: pt.xMm, yMm: pt.yMm, value: "" });
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
        pagina: page.page,
      });
      setDraft(null);
      return;
    }

    if (tool === "seta") {
      onCreateGeometryMark({
        tipo: "seta",
        geometria: {
          x1Mm: draft.xMm,
          y1Mm: draft.yMm,
          x2Mm: pt.xMm,
          y2Mm: pt.yMm,
          espessura,
        },
        pagina: page.page,
      });
      setDraft(null);
      return;
    }

    if (tool === "retangulo" || tool === "circulo") {
      const xMm = Math.min(draft.xMm, pt.xMm);
      const yMm = Math.min(draft.yMm, pt.yMm);
      const wMm = Math.abs(pt.xMm - draft.xMm);
      const hMm = Math.abs(pt.yMm - draft.yMm);
      if (wMm > 0.2 && hMm > 0.2) {
        onCreateGeometryMark({
          tipo: tool,
          geometria: {
            xMm,
            yMm,
            wMm,
            hMm,
            ...(tool === "circulo" ? { espessura } : {}),
          },
          pagina: page.page,
        });
      }
      setDraft(null);
    }
  };

  const startRulerDrag = (e: React.PointerEvent, axis: "x" | "y") => {
    if (tool !== "faixa" || !interactive) return;
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const el = imgRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const startMm =
      axis === "x"
        ? Math.max(
            0,
            Math.min(
              widthMm,
              ((e.clientX - rect.left) / Math.max(1, rect.width)) * widthMm,
            ),
          )
        : Math.max(
            0,
            Math.min(
              heightMm,
              ((e.clientY - rect.top) / Math.max(1, rect.height)) * heightMm,
            ),
          );
    setRulerDrag({ axis, startMm, currentMm: startMm });
  };

  const moveRulerDrag = (e: React.PointerEvent, axis: "x" | "y") => {
    if (!rulerDrag || rulerDrag.axis !== axis) return;
    const el = imgRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const currentMm =
      axis === "x"
        ? Math.max(
            0,
            Math.min(
              widthMm,
              ((e.clientX - rect.left) / Math.max(1, rect.width)) * widthMm,
            ),
          )
        : Math.max(
            0,
            Math.min(
              heightMm,
              ((e.clientY - rect.top) / Math.max(1, rect.height)) * heightMm,
            ),
          );
    setRulerDrag({ ...rulerDrag, currentMm });
  };

  const endRulerDrag = (e: React.PointerEvent) => {
    if (!rulerDrag) return;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    const dragEdge =
      rulerDrag.axis === "x"
        ? edge === "all"
          ? "left"
          : edge
        : edge === "all"
          ? "top"
          : edge;
    const converted = faixaFromDrag(
      dragEdge,
      rulerDrag.startMm,
      rulerDrag.currentMm,
      widthMm,
      heightMm,
    );
    setRulerDrag(null);
    if (!converted || converted.toMm <= converted.fromMm) return;
    onCreateFaixaDrag({ ...converted, pagina: page.page });
  };

  const startFree = (e: React.PointerEvent) => {
    if (!interactive || tool !== "livre") return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const pt = toMm(e.clientX, e.clientY);
    if (!pt) return;
    setFreePoints([[pt.xMm, pt.yMm]]);
  };

  const moveFree = (e: React.PointerEvent) => {
    if (!freePoints) return;
    const pt = toMm(e.clientX, e.clientY);
    if (!pt) return;
    setFreePoints((prev) => {
      if (!prev?.length) return [[pt.xMm, pt.yMm]];
      const last = prev[prev.length - 1];
      const dx = pt.xMm - last[0];
      const dy = pt.yMm - last[1];
      if (Math.hypot(dx, dy) < 0.5) return prev;
      if (prev.length >= 2000) return prev;
      return [...prev, [pt.xMm, pt.yMm]];
    });
  };

  const endFree = (e: React.PointerEvent) => {
    if (!freePoints) return;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    if (freePoints.length >= 2) {
      onCreateGeometryMark({
        tipo: "livre",
        geometria: { points: freePoints, espessura },
        pagina: page.page,
      });
    }
    setFreePoints(null);
  };

  const faixaPreview = rulerDrag
    ? faixaFromDrag(
        rulerDrag.axis === "x"
          ? edge === "all"
            ? "left"
            : edge
          : edge === "all"
            ? "top"
            : edge,
        rulerDrag.startMm,
        rulerDrag.currentMm,
        widthMm,
        heightMm,
      )
    : null;

  const twoClickPreview =
    draft &&
    hoverMm &&
    (tool === "medida" ||
      tool === "retangulo" ||
      tool === "seta" ||
      tool === "circulo");

  return (
    <div
      className="relative bg-white shadow"
      style={{ width: displayW, height: displayH }}
      data-page={page.page}
      onClick={handleClick}
      onMouseMove={(e) => {
        const pt = toMm(e.clientX, e.clientY);
        if (pt) setHoverMm({ x: pt.xMm, y: pt.yMm });
      }}
      onMouseLeave={() => setHoverMm(null)}
      onPointerDown={tool === "livre" ? startFree : undefined}
      onPointerMove={tool === "livre" ? moveFree : undefined}
      onPointerUp={tool === "livre" ? endFree : undefined}
    >
      {showLeftRuler ? (
        <div
          className={
            leftRulerActive
              ? "absolute -left-6 top-0 z-10 h-full w-6 cursor-row-resize border-r border-sky-400 bg-sky-50 text-[9px] text-neutral-500"
              : "pointer-events-none absolute -left-6 top-0 h-full w-6 border-r border-neutral-300 bg-neutral-100 text-[9px] text-neutral-500"
          }
          onPointerDown={
            leftRulerActive ? (e) => startRulerDrag(e, "y") : undefined
          }
          onPointerMove={
            leftRulerActive ? (e) => moveRulerDrag(e, "y") : undefined
          }
          onPointerUp={leftRulerActive ? endRulerDrag : undefined}
          aria-hidden
        >
          {Array.from({ length: Math.floor(heightMm / 10) + 1 }).map((_, i) => (
            <div
              key={`ry-${page.page}-${i}`}
              className="absolute right-0 border-t border-neutral-400 pr-0.5"
              style={{ top: `${(i * 10 * 100) / heightMm}%` }}
            >
              {i * 10}
            </div>
          ))}
        </div>
      ) : null}
      <div
        className={
          topRulerActive
            ? "absolute -top-5 left-0 z-10 h-5 w-full cursor-col-resize border-b border-sky-400 bg-sky-50 text-[9px] text-neutral-500"
            : "pointer-events-none absolute -top-5 left-0 h-5 w-full border-b border-neutral-300 bg-neutral-100 text-[9px] text-neutral-500"
        }
        onPointerDown={
          topRulerActive ? (e) => startRulerDrag(e, "x") : undefined
        }
        onPointerMove={
          topRulerActive ? (e) => moveRulerDrag(e, "x") : undefined
        }
        onPointerUp={topRulerActive ? endRulerDrag : undefined}
        aria-hidden
      >
        {Array.from({ length: Math.floor(widthMm / 10) + 1 }).map((_, i) => (
          <div
            key={`rx-${page.page}-${i}`}
            className="absolute bottom-0 border-l border-neutral-400 pl-0.5"
            style={{ left: `${(i * 10 * 100) / widthMm}%` }}
          >
            {i * 10}
          </div>
        ))}
      </div>

      {loadSrc ? (
        <img
          ref={imgRef}
          src={resolveUrl(page.page)}
          alt={`Página ${page.page}`}
          className="block h-full w-full select-none"
          draggable={false}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-neutral-100 text-xs text-neutral-400">
          Página {page.page}
        </div>
      )}

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

      {rulerDrag && faixaPreview ? (
        <svg
          className="pointer-events-none absolute inset-0 h-full w-full"
          viewBox={`0 0 ${displayW} ${displayH}`}
          aria-hidden
        >
          {rulerDrag.axis === "x" ? (
            <rect
              x={
                (Math.min(rulerDrag.startMm, rulerDrag.currentMm) / widthMm) *
                displayW
              }
              y={0}
              width={
                (Math.abs(rulerDrag.currentMm - rulerDrag.startMm) / widthMm) *
                displayW
              }
              height={displayH}
              fill="rgba(245,158,11,0.2)"
              stroke="#d97706"
              strokeWidth={1.5}
              strokeDasharray="4 3"
            />
          ) : (
            <rect
              x={0}
              y={
                (Math.min(rulerDrag.startMm, rulerDrag.currentMm) / heightMm) *
                displayH
              }
              width={displayW}
              height={
                (Math.abs(rulerDrag.currentMm - rulerDrag.startMm) / heightMm) *
                displayH
              }
              fill="rgba(245,158,11,0.2)"
              stroke="#d97706"
              strokeWidth={1.5}
              strokeDasharray="4 3"
            />
          )}
        </svg>
      ) : null}

      {twoClickPreview && draft && hoverMm ? (
        <svg
          className="pointer-events-none absolute inset-0 h-full w-full"
          viewBox={`0 0 ${displayW} ${displayH}`}
          aria-hidden
        >
          {tool === "medida" || tool === "seta" ? (
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
              {tool === "medida" ? (
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
              ) : null}
            </>
          ) : tool === "circulo" ? (
            <ellipse
              cx={
                ((Math.min(draft.xMm, hoverMm.x) +
                  Math.abs(hoverMm.x - draft.xMm) / 2) /
                  widthMm) *
                displayW
              }
              cy={
                ((Math.min(draft.yMm, hoverMm.y) +
                  Math.abs(hoverMm.y - draft.yMm) / 2) /
                  heightMm) *
                displayH
              }
              rx={(Math.abs(hoverMm.x - draft.xMm) / 2 / widthMm) * displayW}
              ry={(Math.abs(hoverMm.y - draft.yMm) / 2 / heightMm) * displayH}
              fill="rgba(14,165,233,0.12)"
              stroke="#0ea5e9"
              strokeWidth={1.5}
              strokeDasharray="4 3"
            />
          ) : (
            <rect
              x={(Math.min(draft.xMm, hoverMm.x) / widthMm) * displayW}
              y={(Math.min(draft.yMm, hoverMm.y) / heightMm) * displayH}
              width={(Math.abs(hoverMm.x - draft.xMm) / widthMm) * displayW}
              height={(Math.abs(hoverMm.y - draft.yMm) / heightMm) * displayH}
              fill="rgba(14,165,233,0.15)"
              stroke="#0ea5e9"
              strokeWidth={1.5}
              strokeDasharray="4 3"
            />
          )}
        </svg>
      ) : null}

      {freePoints && freePoints.length > 1 ? (
        <svg
          className="pointer-events-none absolute inset-0 h-full w-full"
          viewBox={`0 0 ${displayW} ${displayH}`}
          aria-hidden
        >
          <path
            d={freePoints
              .map((pt, i) => {
                const x = (pt[0] / widthMm) * displayW;
                const y = (pt[1] / heightMm) * displayH;
                return `${i === 0 ? "M" : "L"}${x},${y}`;
              })
              .join(" ")}
            fill="none"
            stroke="#0ea5e9"
            strokeWidth={espessura}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
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

      {textDraft ? (
        <input
          autoFocus
          value={textDraft.value}
          onChange={(e) =>
            setTextDraft({ ...textDraft, value: e.target.value })
          }
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              const value = textDraft.value.trim();
              if (value) {
                onCreateGeometryMark({
                  tipo: "texto",
                  geometria: {
                    xMm: textDraft.xMm,
                    yMm: textDraft.yMm,
                    texto: value,
                    tamanhoPt: 12,
                  },
                  pagina: page.page,
                });
              }
              setTextDraft(null);
            } else if (e.key === "Escape") {
              setTextDraft(null);
            }
          }}
          onBlur={() => {
            const value = textDraft.value.trim();
            if (value) {
              onCreateGeometryMark({
                tipo: "texto",
                geometria: {
                  xMm: textDraft.xMm,
                  yMm: textDraft.yMm,
                  texto: value,
                  tamanhoPt: 12,
                },
                pagina: page.page,
              });
            }
            setTextDraft(null);
          }}
          className="absolute z-20 min-w-[8rem] rounded border border-sky-400 bg-white px-1 py-0.5 text-xs shadow"
          style={{
            left: `${(textDraft.xMm / widthMm) * 100}%`,
            top: `${(textDraft.yMm / heightMm) * 100}%`,
          }}
          placeholder="Texto…"
        />
      ) : null}
    </div>
  );
}
