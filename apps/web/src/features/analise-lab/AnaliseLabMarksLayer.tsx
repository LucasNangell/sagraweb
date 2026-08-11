import type { ReactNode } from "react";

import type { AnaliseLabMark } from "@/api/analiseLab";
import {
  distanceMm,
  formatMm,
  resolveMarkGeometry,
  sangriaAllRects,
  sangriaSvgRect,
} from "./analiseLabGeometry";
import { isMarkVisibleOnPage } from "./analiseLabPageSpec";

const COLOR_MAP: Record<string, string> = {
  red: "#dc2626",
  orange: "#ea580c",
  yellow: "#ca8a04",
  green: "#16a34a",
  blue: "#2563eb",
  purple: "#9333ea",
  black: "#111827",
  white: "#f8fafc",
};

function stroke(cor: string): string {
  return COLOR_MAP[cor] || COLOR_MAP.red;
}

const SIDE_EDGES = ["top", "right", "bottom", "left"] as const;

interface AnaliseLabMarksLayerProps {
  marks: AnaliseLabMark[];
  pageNumber: number;
  pageWidthMm: number;
  pageHeightMm: number;
  displayWidth: number;
  displayHeight: number;
  includeMedidas?: boolean;
  selectedMarkId?: number | null;
  /** Área extra fora do papel (mm) para desenhar sangria sem corte. */
  bleedMm?: number;
}

function drawOffset(
  key: string,
  edge: string,
  offset: number,
  color: string,
  rotulo: string | null | undefined,
  selected: boolean,
  displayWidth: number,
  displayHeight: number,
  sx: number,
  sy: number,
): ReactNode {
  let x1 = 0;
  let y1 = 0;
  let x2 = displayWidth;
  let y2 = 0;
  if (edge === "top") {
    y1 = y2 = offset * sy;
  } else if (edge === "bottom") {
    y1 = y2 = displayHeight - offset * sy;
  } else if (edge === "left") {
    x1 = x2 = offset * sx;
    y1 = 0;
    y2 = displayHeight;
  } else {
    x1 = x2 = displayWidth - offset * sx;
    y1 = 0;
    y2 = displayHeight;
  }
  return (
    <g key={key}>
      <line
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        stroke={color}
        strokeWidth={selected ? 2.5 : 1.5}
        strokeDasharray="6 4"
      />
      {rotulo ? (
        <text
          x={Math.min(x1, x2) + 4}
          y={Math.min(y1, y2) + 14}
          fill={color}
          fontSize={11}
        >
          {rotulo}
        </text>
      ) : null}
    </g>
  );
}

function drawFaixa(
  key: string,
  edge: string,
  from: number,
  to: number,
  color: string,
  selected: boolean,
  displayWidth: number,
  displayHeight: number,
  sx: number,
  sy: number,
): ReactNode {
  let x = 0;
  let y = 0;
  let w = displayWidth;
  let h = (to - from) * sy;
  if (edge === "top") {
    y = from * sy;
  } else if (edge === "bottom") {
    y = displayHeight - to * sy;
    h = (to - from) * sy;
  } else if (edge === "left") {
    x = from * sx;
    w = (to - from) * sx;
    h = displayHeight;
  } else {
    x = displayWidth - to * sx;
    w = (to - from) * sx;
    h = displayHeight;
  }
  return (
    <rect
      key={key}
      x={x}
      y={y}
      width={Math.max(1, w)}
      height={Math.max(1, h)}
      fill={color}
      fillOpacity={selected ? 0.28 : 0.18}
      stroke={color}
      strokeWidth={selected ? 2 : 1}
    />
  );
}

function drawSangria(
  key: string,
  edge: string,
  from: number,
  to: number,
  alongFrom: number,
  alongTo: number,
  color: string,
  selected: boolean,
  displayWidth: number,
  displayHeight: number,
  sx: number,
  sy: number,
): ReactNode {
  const r = sangriaSvgRect(
    edge,
    from,
    to,
    alongFrom,
    alongTo,
    displayWidth,
    displayHeight,
    sx,
    sy,
  );
  return (
    <rect
      key={key}
      x={r.x}
      y={r.y}
      width={r.width}
      height={r.height}
      fill={color}
      fillOpacity={selected ? 0.32 : 0.22}
      stroke={color}
      strokeWidth={selected ? 2 : 1}
    />
  );
}

export function AnaliseLabMarksLayer({
  marks,
  pageNumber,
  pageWidthMm,
  pageHeightMm,
  displayWidth,
  displayHeight,
  includeMedidas = true,
  selectedMarkId = null,
  bleedMm = 0,
}: AnaliseLabMarksLayerProps) {
  const sx = pageWidthMm > 0 ? displayWidth / pageWidthMm : 1;
  const sy = pageHeightMm > 0 ? displayHeight / pageHeightMm : 1;
  const bleedX = Math.max(0, bleedMm) * sx;
  const bleedY = Math.max(0, bleedMm) * sy;

  const visible = marks.filter((m) => {
    if (!isMarkVisibleOnPage(m, pageNumber)) return false;
    if (!includeMedidas && m.tipo === "medida") return false;
    return true;
  });

  if (!visible.length) return null;

  return (
    <svg
      className="pointer-events-none absolute overflow-visible"
      style={{
        overflow: "visible",
        left: -bleedX,
        top: -bleedY,
        width: displayWidth + bleedX * 2,
        height: displayHeight + bleedY * 2,
      }}
      viewBox={`${-bleedX} ${-bleedY} ${displayWidth + bleedX * 2} ${
        displayHeight + bleedY * 2
      }`}
      aria-hidden
    >
      {visible.map((mark) => {
        const color = stroke(mark.cor);
        const selected = selectedMarkId === mark.id;
        const g = resolveMarkGeometry(mark, pageNumber, pageWidthMm);
        if (mark.tipo === "offset_corte") {
          const edge = String(g.edge || "top");
          const offset = Number(g.offsetMm) || 0;
          const edges = edge === "all" ? SIDE_EDGES : [edge];
          return (
            <g key={mark.id}>
              {edges.map((e, i) =>
                drawOffset(
                  `${mark.id}-${e}`,
                  e,
                  offset,
                  color,
                  i === 0 ? mark.rotulo : null,
                  selected,
                  displayWidth,
                  displayHeight,
                  sx,
                  sy,
                ),
              )}
            </g>
          );
        }
        if (mark.tipo === "faixa") {
          const edge = String(g.edge || "top");
          const from = Number(g.fromMm) || 0;
          const to = Number(g.toMm) || 0;
          const edges = edge === "all" ? SIDE_EDGES : [edge];
          return (
            <g key={mark.id}>
              {edges.map((e) =>
                drawFaixa(
                  `${mark.id}-${e}`,
                  e,
                  from,
                  to,
                  color,
                  selected,
                  displayWidth,
                  displayHeight,
                  sx,
                  sy,
                ),
              )}
            </g>
          );
        }
        if (mark.tipo === "sangria") {
          const edge = String(g.edge || "left");
          const from = Number(g.fromMm) || 0;
          const to = Number(g.toMm) || 0;
          const alongFrom = Number(g.alongFromMm) || 0;
          const alongTo = Number(g.alongToMm) || 0;
          if (edge === "all") {
            const rects = sangriaAllRects(
              Math.abs(from),
              pageWidthMm,
              pageHeightMm,
              displayWidth,
              displayHeight,
              sx,
              sy,
            );
            return (
              <g key={mark.id}>
                {rects.map((rect) => (
                  <rect
                    key={`${mark.id}-${rect.edge}`}
                    x={rect.x}
                    y={rect.y}
                    width={rect.width}
                    height={rect.height}
                    fill={color}
                    fillOpacity={selected ? 0.32 : 0.22}
                    stroke={color}
                    strokeWidth={selected ? 2 : 1}
                  />
                ))}
                {mark.rotulo ? (
                  <text
                    x={2}
                    y={-Math.abs(from) * sy - 3}
                    fill={color}
                    fontSize={11}
                  >
                    {mark.rotulo}
                  </text>
                ) : null}
              </g>
            );
          }
          const r = sangriaSvgRect(
            edge,
            from,
            to,
            alongFrom,
            alongTo,
            displayWidth,
            displayHeight,
            sx,
            sy,
          );
          return (
            <g key={mark.id}>
              {drawSangria(
                String(mark.id),
                edge,
                from,
                to,
                alongFrom,
                alongTo,
                color,
                selected,
                displayWidth,
                displayHeight,
                sx,
                sy,
              )}
              {mark.rotulo ? (
                <text
                  x={r.x + 2}
                  y={r.y + 12}
                  fill={color}
                  fontSize={11}
                >
                  {mark.rotulo}
                </text>
              ) : null}
            </g>
          );
        }
        if (mark.tipo === "retangulo") {
          const x = Number(g.xMm) * sx;
          const y = Number(g.yMm) * sy;
          const w = Number(g.wMm) * sx;
          const h = Number(g.hMm) * sy;
          return (
            <g key={mark.id}>
              <rect
                x={x}
                y={y}
                width={Math.max(1, w)}
                height={Math.max(1, h)}
                fill="none"
                stroke={color}
                strokeWidth={selected ? 2.5 : 1.5}
              />
              {mark.rotulo ? (
                <text x={x + 2} y={y - 4} fill={color} fontSize={11}>
                  {mark.rotulo}
                </text>
              ) : null}
            </g>
          );
        }
        if (mark.tipo === "ponto") {
          const x = Number(g.xMm) * sx;
          const y = Number(g.yMm) * sy;
          return (
            <g key={mark.id}>
              <circle
                cx={x}
                cy={y}
                r={selected ? 5 : 4}
                fill={color}
              />
              {mark.rotulo ? (
                <text x={x + 6} y={y - 6} fill={color} fontSize={11}>
                  {mark.rotulo}
                </text>
              ) : null}
            </g>
          );
        }
        if (mark.tipo === "medida") {
          const x1 = Number(g.x1Mm) * sx;
          const y1 = Number(g.y1Mm) * sy;
          const x2 = Number(g.x2Mm) * sx;
          const y2 = Number(g.y2Mm) * sy;
          const dist = distanceMm(
            Number(g.x1Mm),
            Number(g.y1Mm),
            Number(g.x2Mm),
            Number(g.y2Mm),
          );
          const distLabel = formatMm(dist);
          const label = mark.rotulo
            ? `${mark.rotulo} · ${distLabel}`
            : distLabel;
          return (
            <g key={mark.id}>
              <line
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke={color}
                strokeWidth={selected ? 2.5 : 1.5}
              />
              <circle cx={x1} cy={y1} r={3} fill={color} />
              <circle cx={x2} cy={y2} r={3} fill={color} />
              <text
                x={(x1 + x2) / 2 + 4}
                y={(y1 + y2) / 2 - 4}
                fill={color}
                fontSize={11}
              >
                {label}
              </text>
            </g>
          );
        }
        if (mark.tipo === "grade") {
          const step = Math.max(1, Number(g.stepMm) || 10);
          const lines: ReactNode[] = [];
          for (let mm = step; mm < pageWidthMm; mm += step) {
            const x = mm * sx;
            lines.push(
              <line
                key={`vx-${mark.id}-${mm}`}
                x1={x}
                y1={0}
                x2={x}
                y2={displayHeight}
                stroke={color}
                strokeOpacity={0.35}
                strokeWidth={selected ? 1.25 : 0.75}
              />,
            );
          }
          for (let mm = step; mm < pageHeightMm; mm += step) {
            const y = mm * sy;
            lines.push(
              <line
                key={`hy-${mark.id}-${mm}`}
                x1={0}
                y1={y}
                x2={displayWidth}
                y2={y}
                stroke={color}
                strokeOpacity={0.35}
                strokeWidth={selected ? 1.25 : 0.75}
              />,
            );
          }
          return <g key={mark.id}>{lines}</g>;
        }
        if (mark.tipo === "seta") {
          const x1 = Number(g.x1Mm) * sx;
          const y1 = Number(g.y1Mm) * sy;
          const x2 = Number(g.x2Mm) * sx;
          const y2 = Number(g.y2Mm) * sy;
          const lw = Math.max(1, Number(g.espessura) || 2);
          const headLen = Math.max(10, lw * 5);
          const angle = Math.atan2(y2 - y1, x2 - x1);
          const ax1 = x2 - headLen * Math.cos(angle - Math.PI / 6);
          const ay1 = y2 - headLen * Math.sin(angle - Math.PI / 6);
          const ax2 = x2 - headLen * Math.cos(angle + Math.PI / 6);
          const ay2 = y2 - headLen * Math.sin(angle + Math.PI / 6);
          return (
            <g key={mark.id}>
              <line
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke={color}
                strokeWidth={selected ? lw + 1 : lw}
              />
              <polygon
                points={`${x2},${y2} ${ax1},${ay1} ${ax2},${ay2}`}
                fill={color}
              />
              {mark.rotulo ? (
                <text
                  x={(x1 + x2) / 2 + 4}
                  y={(y1 + y2) / 2 - 4}
                  fill={color}
                  fontSize={11}
                >
                  {mark.rotulo}
                </text>
              ) : null}
            </g>
          );
        }
        if (mark.tipo === "circulo") {
          const x = Number(g.xMm) * sx;
          const y = Number(g.yMm) * sy;
          const w = Math.max(1, Number(g.wMm) * sx);
          const h = Math.max(1, Number(g.hMm) * sy);
          const lw = Math.max(1, Number(g.espessura) || 2);
          return (
            <g key={mark.id}>
              <ellipse
                cx={x + w / 2}
                cy={y + h / 2}
                rx={w / 2}
                ry={h / 2}
                fill="none"
                stroke={color}
                strokeWidth={selected ? lw + 1 : lw}
              />
              {mark.rotulo ? (
                <text x={x + 2} y={y - 4} fill={color} fontSize={11}>
                  {mark.rotulo}
                </text>
              ) : null}
            </g>
          );
        }
        if (mark.tipo === "texto") {
          const x = Number(g.xMm) * sx;
          const y = Number(g.yMm) * sy;
          const fontSize = Math.max(8, (Number(g.tamanhoPt) || 12) * (sx * 0.35));
          const label = String(g.texto || mark.rotulo || "");
          return (
            <g key={mark.id}>
              <text
                x={x}
                y={y}
                fill={color}
                fontSize={fontSize}
                fontWeight={selected ? 700 : 500}
              >
                {label}
              </text>
            </g>
          );
        }
        if (mark.tipo === "livre") {
          const pts = Array.isArray(g.points) ? g.points : [];
          if (pts.length < 2) return null;
          const lw = Math.max(1, Number(g.espessura) || 2);
          const d = pts
            .map((pt, i) => {
              const x = Number(pt?.[0]) * sx;
              const y = Number(pt?.[1]) * sy;
              return `${i === 0 ? "M" : "L"}${x},${y}`;
            })
            .join(" ");
          return (
            <g key={mark.id}>
              <path
                d={d}
                fill="none"
                stroke={color}
                strokeWidth={selected ? lw + 1 : lw}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </g>
          );
        }
        return null;
      })}
    </svg>
  );
}
