import { Loader2 } from "lucide-react";
import { useMemo } from "react";

import type {
  CropSidesMm,
  FoldCrease,
  FoldOperation,
  ProvaWebFolhetoCrop,
} from "@/api/provaWeb";
import { cn } from "@sagra/ui";

import { DEFAULT_ARTWORK_BACK } from "./fold-engine/foldTypes";
import type { FoldTopology } from "./fold-engine/foldTypes";
import { FOLD_LINE_COLORS } from "./provaWebFoldPresets";
import {
  buildFoldArrowGeoms,
  panelArtBackgroundStyle,
} from "./foldSchemaGeometry";
import { useProvaWebPdfPageRaster } from "./useProvaWebPdfPageRaster";

export type FoldSchemaPreviewProps = {
  ano: number;
  osId: number;
  arquivoUnico: string;
  folheto: Pick<
    ProvaWebFolhetoCrop,
    | "crop"
    | "creases"
    | "operations"
    | "pageFrente"
    | "pageVerso"
    | "basePanelId"
    | "backArtworkTransform"
  >;
  topology: FoldTopology;
  usable: { w: number; h: number };
  pageWidthMm: number;
  pageHeightMm: number;
  selectedOpId: string | null;
  movingIds: Set<string>;
};

function arrowMarkerId(opId: string, face: string): string {
  return `fold-schema-arrow-${face}-${opId}`;
}

function SchemaFace({
  label,
  face,
  topology,
  creases,
  operations,
  selectedOpId,
  movingIds,
  basePanelId,
  usable,
  dataUrl,
  loading,
  error,
  duplexTurn,
}: {
  label: string;
  face: "front" | "back";
  topology: FoldTopology;
  creases: FoldCrease[];
  operations: FoldOperation[];
  selectedOpId: string | null;
  movingIds: Set<string>;
  basePanelId: string | null | undefined;
  usable: { w: number; h: number };
  dataUrl: string | null;
  loading: boolean;
  error: string | null;
  duplexTurn: boolean;
}) {
  const mirrorVertical = face === "back" && duplexTurn;
  const arrows = useMemo(
    () =>
      buildFoldArrowGeoms({
        topology,
        creases,
        operations,
        selectedOpId,
        mirrorVerticalCreases: mirrorVertical,
      }),
    [topology, creases, operations, selectedOpId, mirrorVertical],
  );

  const aspect = usable.w > 0 && usable.h > 0 ? usable.w / usable.h : 1.5;

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-neutral-700">{label}</p>
        {face === "back" && duplexTurn ? (
          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-neutral-500">
            Arte duplex (L↔R)
          </span>
        ) : null}
      </div>
      <div
        className="relative w-full overflow-hidden rounded-lg border border-sagra-border bg-slate-100 shadow-sm"
        style={{ aspectRatio: String(aspect) }}
      >
        {loading ? (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-slate-50/80">
            <Loader2 className="size-5 animate-spin text-primary-green" aria-hidden />
          </div>
        ) : null}
        {error ? (
          <p className="absolute inset-0 z-20 flex items-center justify-center p-3 text-center text-[11px] text-red-700">
            {error}
          </p>
        ) : null}

        {topology.panels.map((p) => {
          const moving = movingIds.has(p.id);
          const isBase = basePanelId === p.id;
          const left = (p.xMm / usable.w) * 100;
          const top = (p.yMm / usable.h) * 100;
          const width = (p.widthMm / usable.w) * 100;
          const height = (p.heightMm / usable.h) * 100;
          const art = panelArtBackgroundStyle({
            panelXMm: p.xMm,
            panelYMm: p.yMm,
            panelWidthMm: p.widthMm,
            panelHeightMm: p.heightMm,
            usableW: usable.w,
            usableH: usable.h,
            duplexTurn,
            face,
            dataUrl,
          });
          return (
            <div
              key={`${face}-${p.id}`}
              className={cn(
                "absolute box-border overflow-hidden",
                moving
                  ? "ring-2 ring-emerald-500 ring-inset"
                  : isBase
                    ? "ring-2 ring-amber-400 ring-inset"
                    : "ring-1 ring-slate-400/70 ring-inset",
              )}
              style={{
                left: `${left}%`,
                top: `${top}%`,
                width: `${width}%`,
                height: `${height}%`,
                ...art,
              }}
            >
              <span
                className={cn(
                  "absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2 rounded px-1.5 py-0.5 text-[10px] font-bold shadow",
                  moving
                    ? "bg-emerald-600 text-white"
                    : isBase
                      ? "bg-amber-500 text-white"
                      : "bg-black/55 text-white",
                )}
              >
                {p.id}
              </span>
            </div>
          );
        })}

        <svg
          className="pointer-events-none absolute inset-0 z-10 h-full w-full"
          viewBox={`0 0 ${usable.w} ${usable.h}`}
          preserveAspectRatio="none"
        >
          <defs>
            {arrows.map((a) => (
              <marker
                key={arrowMarkerId(a.opId, face)}
                id={arrowMarkerId(a.opId, face)}
                markerWidth="6"
                markerHeight="6"
                refX="5"
                refY="3"
                orient="auto"
                markerUnits="strokeWidth"
              >
                <path
                  d="M0,0 L6,3 L0,6 Z"
                  fill={a.selected ? a.color : a.color}
                  opacity={a.selected ? 1 : 0.85}
                />
              </marker>
            ))}
          </defs>

          {creases.map((c, i) => {
            const color = FOLD_LINE_COLORS[i % FOLD_LINE_COLORS.length]!;
            if (c.axis === "vertical") {
              const x = mirrorVertical
                ? usable.w - c.positionMm
                : c.positionMm;
              return (
                <line
                  key={`${face}-c-${c.id}`}
                  x1={x}
                  y1={0}
                  x2={x}
                  y2={usable.h}
                  stroke={color}
                  strokeWidth={Math.max(0.8, usable.w * 0.004)}
                  strokeDasharray={`${usable.w * 0.012} ${usable.w * 0.008}`}
                />
              );
            }
            return (
              <line
                key={`${face}-c-${c.id}`}
                x1={0}
                y1={c.positionMm}
                x2={usable.w}
                y2={c.positionMm}
                stroke={color}
                strokeWidth={Math.max(0.8, usable.h * 0.004)}
                strokeDasharray={`${usable.h * 0.012} ${usable.h * 0.008}`}
              />
            );
          })}

          {arrows.map((a) => {
            const sw = a.selected
              ? Math.max(1.6, usable.w * 0.008)
              : Math.max(1.1, usable.w * 0.005);
            const midX = (a.x1 + a.x2) / 2;
            const midY = (a.y1 + a.y2) / 2;
            const towardsHint = a.towards === "front" ? "F" : "V";
            return (
              <g key={`${face}-a-${a.opId}`} opacity={a.selected ? 1 : 0.75}>
                <line
                  x1={a.x1}
                  y1={a.y1}
                  x2={a.x2}
                  y2={a.y2}
                  stroke={a.color}
                  strokeWidth={sw}
                  strokeLinecap="round"
                  markerEnd={`url(#${arrowMarkerId(a.opId, face)})`}
                />
                <circle
                  cx={a.x1}
                  cy={a.y1}
                  r={Math.max(5, usable.w * 0.018)}
                  fill={a.color}
                  stroke="#fff"
                  strokeWidth={usable.w * 0.003}
                />
                <text
                  x={a.x1}
                  y={a.y1}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fill="#fff"
                  fontSize={Math.max(7, usable.w * 0.028)}
                  fontWeight={700}
                >
                  {a.orderLabel}
                </text>
                <text
                  x={midX}
                  y={midY - usable.h * 0.035}
                  textAnchor="middle"
                  fill={a.color}
                  fontSize={Math.max(6, usable.w * 0.022)}
                  fontWeight={600}
                  style={{ paintOrder: "stroke", stroke: "#fff", strokeWidth: 2 }}
                >
                  {towardsHint}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

export function FoldSchemaPreview({
  ano,
  osId,
  arquivoUnico,
  folheto,
  topology,
  usable,
  pageWidthMm,
  pageHeightMm,
  selectedOpId,
  movingIds,
}: FoldSchemaPreviewProps) {
  const pageFrente = Math.max(0, folheto.pageFrente ?? 0);
  const pageVerso =
    folheto.pageVerso == null ? null : Math.max(0, folheto.pageVerso);
  const hasVerso = pageVerso != null;
  const duplexTurn = Boolean(
    folheto.backArtworkTransform?.mirrorX ?? DEFAULT_ARTWORK_BACK.mirrorX,
  );

  const crop: CropSidesMm = folheto.crop;
  const front = useProvaWebPdfPageRaster({
    ano,
    osId,
    relativePath: arquivoUnico,
    pageIndex: pageFrente,
    crop,
    pageWidthMm,
    pageHeightMm,
    enabled: true,
  });
  const back = useProvaWebPdfPageRaster({
    ano,
    osId,
    relativePath: arquivoUnico,
    pageIndex: pageVerso,
    crop,
    pageWidthMm,
    pageHeightMm,
    enabled: Boolean(hasVerso),
  });

  if (topology.panels.length === 0) {
    return null;
  }

  return (
    <div className="space-y-2">
      <div
        className={cn(
          "grid gap-3",
          hasVerso ? "sm:grid-cols-2" : "grid-cols-1",
        )}
      >
        <SchemaFace
          label="Frente (arte do PDF)"
          face="front"
          topology={topology}
          creases={folheto.creases}
          operations={folheto.operations}
          selectedOpId={selectedOpId}
          movingIds={movingIds}
          basePanelId={folheto.basePanelId}
          usable={usable}
          dataUrl={front.raster?.dataUrl ?? null}
          loading={front.loading}
          error={front.error}
          duplexTurn={false}
        />
        {hasVerso ? (
          <SchemaFace
            label="Verso (atrás de cada painel)"
            face="back"
            topology={topology}
            creases={folheto.creases}
            operations={folheto.operations}
            selectedOpId={selectedOpId}
            movingIds={movingIds}
            basePanelId={folheto.basePanelId}
            usable={usable}
            dataUrl={back.raster?.dataUrl ?? null}
            loading={back.loading}
            error={back.error}
            duplexTurn={duplexTurn}
          />
        ) : null}
      </div>
      <p className="text-[11px] leading-snug text-neutral-500">
        Faixas = painéis no PDF (<span className="font-medium">p0</span>,{" "}
        <span className="font-medium">p1</span>…). Setas numeradas = sequência de
        dobra (1ª fecha primeiro). Verde = aba móvel da operação selecionada ·
        âmbar = miolo. <span className="font-medium">F</span> = dobra sobre a
        frente · <span className="font-medium">V</span> = sobre o verso.
      </p>
    </div>
  );
}
