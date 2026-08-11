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
  sangriaFromDrag,
  sangriaSvgRect,
} from "./analiseLabGeometry";
import { gridLinesMm } from "./analiseLabViewPrefs";

type RulerDrag = {
  axis: "x" | "y";
  startMm: number;
  currentMm: number;
  mode: "faixa" | "guide";
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
  /** Profundidade da sangria (mm) — usada só com tool=sangria. */
  sangriaMm?: number;
  selectedMarkId?: number | null;
  showLeftRuler: boolean;
  showRulers?: boolean;
  grid?: boolean;
  gridStepMm?: number;
  guides?: boolean;
  guidesXMm?: number[];
  guidesYMm?: number[];
  /** Lado colado ao par na vista dupla — zera margem de sangria nesse lado. */
  innerEdge?: "left" | "right";
  tightActiveRing?: boolean;
  interactive: boolean;
  active?: boolean;
  onActivate?: () => void;
  onAddGuide?: (axis: "x" | "y", mm: number) => void;
  onRemoveGuide?: (axis: "x" | "y", mm: number) => void;
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
  sangriaMm = 5,
  selectedMarkId = null,
  showLeftRuler,
  showRulers = true,
  grid = false,
  gridStepMm = 10,
  guides = true,
  guidesXMm = [],
  guidesYMm = [],
  innerEdge,
  tightActiveRing = false,
  interactive,
  active = false,
  onActivate,
  onAddGuide,
  onRemoveGuide,
  onCreateGeometryMark,
  onCreateFaixaDrag,
  onCreateSangriaDrag,
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

  const sangriaEdge = edge === "all" ? "left" : edge;
  const bleedPadMm = tool === "sangria" ? Math.abs(sangriaMm || 5) + 2 : 0;
  const sx = displayW / Math.max(1e-6, widthMm);
  const sy = displayH / Math.max(1e-6, heightMm);
  const bleedPadX = Math.ceil(bleedPadMm * sx);
  const bleedPadY = Math.ceil(bleedPadMm * sy);

  const topFaixaActive =
    interactive &&
    tool === "faixa" &&
    (edge === "left" || edge === "right" || edge === "all");
  const leftFaixaActive =
    interactive &&
    showLeftRuler &&
    tool === "faixa" &&
    (edge === "top" || edge === "bottom" || edge === "all");
  const topGuideActive =
    interactive && showRulers && tool !== "faixa" && Boolean(onAddGuide);
  const leftGuideActive =
    interactive &&
    showRulers &&
    showLeftRuler &&
    tool !== "faixa" &&
    Boolean(onAddGuide);
  const topRulerActive = topFaixaActive || topGuideActive;
  const leftRulerActive = leftFaixaActive || leftGuideActive;
  const guidesSelectable = interactive && tool === "select" && guides;

  const toMm = (clientX: number, clientY: number) => {
    const el = imgRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const xPx = clientX - rect.left;
    const yPx = clientY - rect.top;
    const xMm = (xPx / Math.max(1, rect.width)) * widthMm;
    const yMm = (yPx / Math.max(1, rect.height)) * heightMm;
    if (tool === "sangria") {
      const margin = Math.abs(sangriaMm || 5) + 10;
      return {
        xMm: Math.max(-margin, Math.min(widthMm + margin, xMm)),
        yMm: Math.max(-margin, Math.min(heightMm + margin, yMm)),
      };
    }
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

    if (tool === "sangria") {
      const vertical = sangriaEdge === "left" || sangriaEdge === "right";
      const converted = sangriaFromDrag(
        sangriaEdge,
        sangriaMm,
        vertical ? draft.yMm : draft.xMm,
        vertical ? pt.yMm : pt.xMm,
        widthMm,
        heightMm,
      );
      if (converted && onCreateSangriaDrag) {
        onCreateSangriaDrag({ ...converted, pagina: page.page });
      }
      setDraft(null);
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

  const readRulerMm = (
    clientX: number,
    clientY: number,
    axis: "x" | "y",
  ): number | null => {
    const el = imgRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    if (axis === "x") {
      return Math.max(
        0,
        Math.min(
          widthMm,
          ((clientX - rect.left) / Math.max(1, rect.width)) * widthMm,
        ),
      );
    }
    return Math.max(
      0,
      Math.min(
        heightMm,
        ((clientY - rect.top) / Math.max(1, rect.height)) * heightMm,
      ),
    );
  };

  const startRulerDrag = (e: React.PointerEvent, axis: "x" | "y") => {
    if (!interactive) return;
    const mode: "faixa" | "guide" =
      tool === "faixa" ? "faixa" : onAddGuide ? "guide" : "faixa";
    if (mode === "faixa" && tool !== "faixa") return;
    if (mode === "guide" && !onAddGuide) return;
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const startMm = readRulerMm(e.clientX, e.clientY, axis);
    if (startMm == null) return;
    setRulerDrag({ axis, startMm, currentMm: startMm, mode });
  };

  const moveRulerDrag = (e: React.PointerEvent, axis: "x" | "y") => {
    if (!rulerDrag || rulerDrag.axis !== axis) return;
    const currentMm = readRulerMm(e.clientX, e.clientY, axis);
    if (currentMm == null) return;
    setRulerDrag({ ...rulerDrag, currentMm });
  };

  const endRulerDrag = (e: React.PointerEvent) => {
    if (!rulerDrag) return;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    const drag = rulerDrag;
    setRulerDrag(null);
    if (drag.mode === "guide") {
      onAddGuide?.(drag.axis, drag.currentMm);
      return;
    }
    const dragEdge =
      drag.axis === "x"
        ? edge === "all"
          ? "left"
          : edge
        : edge === "all"
          ? "top"
          : edge;
    const converted = faixaFromDrag(
      dragEdge,
      drag.startMm,
      drag.currentMm,
      widthMm,
      heightMm,
    );
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

  const faixaPreview =
    rulerDrag?.mode === "faixa"
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

  const bleedMargin =
    tool === "sangria"
      ? {
          marginTop: bleedPadY,
          marginBottom: bleedPadY,
          marginLeft: innerEdge === "left" ? 0 : bleedPadX,
          marginRight: innerEdge === "right" ? 0 : bleedPadX,
        }
      : undefined;

  const gridX = grid ? gridLinesMm(widthMm, gridStepMm) : [];
  const gridY = grid ? gridLinesMm(heightMm, gridStepMm) : [];
  const showGuidesOverlay =
    (guides && (guidesXMm.length > 0 || guidesYMm.length > 0)) ||
    rulerDrag?.mode === "guide";

  const twoClickPreview =
    draft &&
    hoverMm &&
    (tool === "medida" ||
      tool === "retangulo" ||
      tool === "seta" ||
      tool === "circulo" ||
      tool === "sangria");

  const sangriaPreview =
    tool === "sangria" && draft && hoverMm
      ? (() => {
          const vertical = sangriaEdge === "left" || sangriaEdge === "right";
          return sangriaFromDrag(
            sangriaEdge,
            sangriaMm,
            vertical ? draft.yMm : draft.xMm,
            vertical ? hoverMm.y : hoverMm.x,
            widthMm,
            heightMm,
          );
        })()
      : null;

  return (
    <div
      className={
        active
          ? tightActiveRing
            ? "relative bg-white shadow ring-2 ring-primary-green"
            : "relative bg-white shadow ring-2 ring-primary-green ring-offset-2"
          : "relative bg-white shadow"
      }
      style={{
        width: displayW,
        height: displayH,
        overflow: "visible",
        ...bleedMargin,
      }}
      data-lab-page={page.page}
      data-page={page.page}
      onPointerDownCapture={() => onActivate?.()}
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
      {showRulers && showLeftRuler ? (
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
      {showRulers ? (
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
      ) : null}

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

      {grid || showGuidesOverlay ? (
        <svg
          className={
            guidesSelectable
              ? "absolute inset-0 h-full w-full"
              : "pointer-events-none absolute inset-0 h-full w-full"
          }
          viewBox={`0 0 ${displayW} ${displayH}`}
          aria-hidden
        >
          {gridX.map((x) => (
            <line
              key={`gx-${page.page}-${x}`}
              x1={(x / widthMm) * displayW}
              y1={0}
              x2={(x / widthMm) * displayW}
              y2={displayH}
              stroke="#94a3b8"
              strokeWidth={0.5}
              opacity={0.55}
              pointerEvents="none"
            />
          ))}
          {gridY.map((y) => (
            <line
              key={`gy-${page.page}-${y}`}
              x1={0}
              y1={(y / heightMm) * displayH}
              x2={displayW}
              y2={(y / heightMm) * displayH}
              stroke="#94a3b8"
              strokeWidth={0.5}
              opacity={0.55}
              pointerEvents="none"
            />
          ))}
          {guides
            ? guidesXMm.map((x) => {
                const xPx = (x / widthMm) * displayW;
                return (
                  <g key={`gux-${page.page}-${x}`}>
                    {guidesSelectable ? (
                      <line
                        x1={xPx}
                        y1={0}
                        x2={xPx}
                        y2={displayH}
                        stroke="#2563eb"
                        strokeWidth={8}
                        strokeOpacity={0.01}
                        className="cursor-pointer"
                        onClick={(e) => {
                          e.stopPropagation();
                          onRemoveGuide?.("x", x);
                        }}
                      />
                    ) : null}
                    <line
                      x1={xPx}
                      y1={0}
                      x2={xPx}
                      y2={displayH}
                      stroke="#2563eb"
                      strokeWidth={1}
                      strokeDasharray="5 4"
                      pointerEvents="none"
                    />
                  </g>
                );
              })
            : null}
          {guides
            ? guidesYMm.map((y) => {
                const yPx = (y / heightMm) * displayH;
                return (
                  <g key={`guy-${page.page}-${y}`}>
                    {guidesSelectable ? (
                      <line
                        x1={0}
                        y1={yPx}
                        x2={displayW}
                        y2={yPx}
                        stroke="#2563eb"
                        strokeWidth={8}
                        strokeOpacity={0.01}
                        className="cursor-pointer"
                        onClick={(e) => {
                          e.stopPropagation();
                          onRemoveGuide?.("y", y);
                        }}
                      />
                    ) : null}
                    <line
                      x1={0}
                      y1={yPx}
                      x2={displayW}
                      y2={yPx}
                      stroke="#2563eb"
                      strokeWidth={1}
                      strokeDasharray="5 4"
                      pointerEvents="none"
                    />
                  </g>
                );
              })
            : null}
          {rulerDrag?.mode === "guide" ? (
            rulerDrag.axis === "x" ? (
              <line
                x1={(rulerDrag.currentMm / widthMm) * displayW}
                y1={0}
                x2={(rulerDrag.currentMm / widthMm) * displayW}
                y2={displayH}
                stroke="#2563eb"
                strokeWidth={1.5}
                strokeDasharray="4 3"
                pointerEvents="none"
              />
            ) : (
              <line
                x1={0}
                y1={(rulerDrag.currentMm / heightMm) * displayH}
                x2={displayW}
                y2={(rulerDrag.currentMm / heightMm) * displayH}
                stroke="#2563eb"
                strokeWidth={1.5}
                strokeDasharray="4 3"
                pointerEvents="none"
              />
            )
          ) : null}
        </svg>
      ) : null}

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
          className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
          viewBox={`0 0 ${displayW} ${displayH}`}
          aria-hidden
        >
          {tool === "sangria" && sangriaPreview ? (
            <rect
              {...sangriaSvgRect(
                sangriaEdge,
                sangriaPreview.fromMm,
                sangriaPreview.toMm,
                sangriaPreview.alongFromMm,
                sangriaPreview.alongToMm,
                displayW,
                displayH,
                sx,
                sy,
              )}
              fill="rgba(14,165,233,0.25)"
              stroke="#0ea5e9"
              strokeWidth={1.5}
              strokeDasharray="4 3"
            />
          ) : tool === "medida" || tool === "seta" ? (
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
