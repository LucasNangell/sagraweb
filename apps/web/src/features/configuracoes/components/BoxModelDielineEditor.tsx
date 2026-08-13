import { useMemo, useState } from "react";

import type { BoxModelConfig } from "@/api/boxModels";

export interface BoxModelDielineEditorProps {
  config: BoxModelConfig;
  selectedPanelId: string | null;
  selectedEdgeId: string | null;
  onSelectPanel: (id: string) => void;
  onSelectEdge: (id: string) => void;
  /** Aviso em destaque (ex.: clique em warning da lista). */
  focusPointMm?: [number, number] | number[] | null;
  onFocusPointConsumed?: () => void;
}

function polyPoints(poly: number[][] | undefined): string | null {
  if (!poly || poly.length < 3) return null;
  return poly.map((p) => `${p[0]},${p[1]}`).join(" ");
}

function polyCentroid(poly: number[][]): { x: number; y: number } {
  let sx = 0;
  let sy = 0;
  const n = poly.length;
  for (const p of poly) {
    sx += p[0] ?? 0;
    sy += p[1] ?? 0;
  }
  return { x: sx / n, y: sy / n };
}

type DiagLayer = "cuts" | "folds" | "faces" | "hinges" | "ids";

export function BoxModelDielineEditor({
  config,
  selectedPanelId,
  selectedEdgeId,
  onSelectPanel,
  onSelectEdge,
  focusPointMm,
}: BoxModelDielineEditorProps) {
  const cut = config.cutBboxMm;
  const pad = 8;
  const vbX = (cut?.x0Mm ?? 0) - pad;
  const vbY = (cut?.y0Mm ?? 0) - pad;
  const vbW = (cut?.widthMm ?? 100) + pad * 2;
  const vbH = (cut?.heightMm ?? 100) + pad * 2;
  const opByHinge = new Map(
    (config.operations ?? []).map((o) => [o.hingeId, o]),
  );
  const edges = config.edges ?? [];
  const outlinePts = polyPoints(config.netOutlineMm);

  const [layers, setLayers] = useState<Record<DiagLayer, boolean>>({
    cuts: true,
    folds: true,
    faces: true,
    hinges: true,
    ids: true,
  });

  const toggle = (key: DiagLayer) =>
    setLayers((prev) => ({ ...prev, [key]: !prev[key] }));

  const rawCuts = useMemo(
    () => config.cutSegmentsMm ?? [],
    [config.cutSegmentsMm],
  );
  const rawFolds = useMemo(
    () => config.foldSegmentsMm ?? [],
    [config.foldSegmentsMm],
  );

  const focus =
    focusPointMm && focusPointMm.length >= 2
      ? { x: Number(focusPointMm[0]), y: Number(focusPointMm[1]) }
      : null;

  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-2 py-1.5 text-[10px] text-slate-600">
        <span className="mr-1 font-semibold text-slate-500">Camadas</span>
        {(
          [
            ["faces", "Faces"],
            ["cuts", "Cortes"],
            ["folds", "Dobras"],
            ["hinges", "Hinges"],
            ["ids", "IDs"],
          ] as const
        ).map(([key, label]) => (
          <label
            key={key}
            className="inline-flex cursor-pointer items-center gap-1 rounded bg-slate-50 px-1.5 py-0.5"
          >
            <input
              type="checkbox"
              checked={layers[key]}
              onChange={() => toggle(key)}
              className="size-3"
            />
            {label}
          </label>
        ))}
        <span className="ml-auto inline-flex items-center gap-1">
          <span className="inline-block size-2.5 rounded-sm bg-blue-400/50 ring-1 ring-blue-500" />
          Base
        </span>
      </div>
      <svg
        viewBox={`${vbX} ${vbY} ${vbW} ${vbH}`}
        className="mx-auto max-h-[420px] w-full"
        role="img"
        aria-label="Faca com painéis, cortes e dobras"
      >
        {outlinePts ? (
          <polygon
            points={outlinePts}
            fill="#f8fafc"
            stroke="#cbd5e1"
            strokeWidth={0.3}
          />
        ) : (
          <rect
            x={cut?.x0Mm ?? 0}
            y={cut?.y0Mm ?? 0}
            width={cut?.widthMm ?? 0}
            height={cut?.heightMm ?? 0}
            fill="#f8fafc"
            stroke="#cbd5e1"
            strokeWidth={0.3}
          />
        )}

        {layers.cuts
          ? rawCuts.map((s, i) => (
              <line
                key={`rc-${i}`}
                x1={s.x1}
                y1={s.y1}
                x2={s.x2}
                y2={s.y2}
                stroke="#94a3b8"
                strokeWidth={0.45}
                opacity={0.55}
              />
            ))
          : null}

        {layers.folds
          ? rawFolds.map((s, i) => (
              <line
                key={`rf-${i}`}
                x1={s.x1}
                y1={s.y1}
                x2={s.x2}
                y2={s.y2}
                stroke="#5eead4"
                strokeWidth={0.55}
                strokeDasharray="2 1.5"
                opacity={0.7}
              />
            ))
          : null}

        {layers.faces
          ? (config.panels ?? [])
              .filter((p) => p.active !== false)
              .map((p) => {
                const selected = p.id === selectedPanelId;
                const isBase = p.id === config.basePanelId;
                const pts = polyPoints(p.polygonMm);
                const fill = selected
                  ? "rgba(31,122,77,0.3)"
                  : isBase
                    ? "rgba(59,130,246,0.22)"
                    : "rgba(148,163,184,0.1)";
                const stroke = selected
                  ? "#1f7a4d"
                  : isBase
                    ? "#3b82f6"
                    : "#94a3b8";
                const c =
                  p.polygonMm && p.polygonMm.length >= 3
                    ? polyCentroid(p.polygonMm)
                    : { x: p.xMm + p.wMm / 2, y: p.yMm + p.hMm / 2 };
                return (
                  <g key={p.id}>
                    {pts ? (
                      <polygon
                        points={pts}
                        fill={fill}
                        stroke={stroke}
                        strokeWidth={selected || isBase ? 1 : 0.35}
                        className="cursor-pointer"
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectPanel(p.id);
                        }}
                      />
                    ) : (
                      <rect
                        x={p.xMm}
                        y={p.yMm}
                        width={p.wMm}
                        height={p.hMm}
                        fill={fill}
                        stroke={stroke}
                        strokeWidth={selected || isBase ? 1 : 0.35}
                        className="cursor-pointer"
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectPanel(p.id);
                        }}
                      />
                    )}
                    {layers.ids && p.wMm > 14 && p.hMm > 10 ? (
                      <text
                        x={c.x}
                        y={c.y}
                        textAnchor="middle"
                        dominantBaseline="middle"
                        fontSize={Math.min(7, Math.max(4, p.wMm / 7))}
                        fill="#334155"
                        className="pointer-events-none select-none"
                      >
                        {p.label || p.id}
                        {isBase ? " ★" : ""}
                      </text>
                    ) : null}
                  </g>
                );
              })
          : null}

        {layers.hinges
          ? (config.hinges ?? []).map((h) => {
              const seg = h.segmentMm;
              if (!seg || seg.length < 2) return null;
              const a = seg[0]!;
              const b = seg[1]!;
              return (
                <line
                  key={`hinge-${h.id}`}
                  x1={a[0]}
                  y1={a[1]}
                  x2={b[0]}
                  y2={b[1]}
                  stroke="#7c3aed"
                  strokeWidth={1.1}
                  strokeLinecap="round"
                  opacity={0.85}
                />
              );
            })
          : null}

        {layers.folds || layers.cuts
          ? edges.map((edge) => {
              const selected = edge.id === selectedEdgeId;
              const isFold = edge.kind === "fold";
              if (isFold && !layers.folds) return null;
              if (!isFold && !layers.cuts) return null;
              const op = edge.hingeId ? opByHinge.get(edge.hingeId) : null;
              const midX = (edge.x1 + edge.x2) / 2;
              const midY = (edge.y1 + edge.y2) / 2;
              return (
                <g
                  key={edge.id}
                  className="cursor-pointer"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectEdge(edge.id);
                  }}
                >
                  <line
                    x1={edge.x1}
                    y1={edge.y1}
                    x2={edge.x2}
                    y2={edge.y2}
                    stroke="transparent"
                    strokeWidth={7}
                  />
                  <line
                    x1={edge.x1}
                    y1={edge.y1}
                    x2={edge.x2}
                    y2={edge.y2}
                    stroke={
                      selected
                        ? "#b45309"
                        : isFold
                          ? "#0d9488"
                          : "#1e293b"
                    }
                    strokeWidth={selected ? 2.6 : isFold ? 1.7 : 1.4}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeDasharray={isFold ? "3.5 2" : undefined}
                  />
                  {op ? (
                    <g className="pointer-events-none">
                      <circle
                        cx={midX}
                        cy={midY}
                        r={3.2}
                        fill={selected ? "#b45309" : "#0f766e"}
                      />
                      <text
                        x={midX}
                        y={midY}
                        textAnchor="middle"
                        dominantBaseline="middle"
                        fontSize={3.5}
                        fontWeight={700}
                        fill="#fff"
                      >
                        {op.order}
                      </text>
                    </g>
                  ) : null}
                </g>
              );
            })
          : null}

        {focus ? (
          <g className="pointer-events-none">
            <circle
              cx={focus.x}
              cy={focus.y}
              r={4}
              fill="none"
              stroke="#dc2626"
              strokeWidth={1.2}
            />
            <circle cx={focus.x} cy={focus.y} r={1.4} fill="#dc2626" />
          </g>
        ) : null}
      </svg>
      <p className="border-t border-slate-100 px-2 py-1 text-[10px] text-slate-500">
        Diagnóstico: faces topológicas, segmentos crus e hinges. Clique numa
        dobra e adicione à sequência.
      </p>
    </div>
  );
}
