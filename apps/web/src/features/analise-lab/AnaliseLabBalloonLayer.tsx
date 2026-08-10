import { useMemo, useState } from "react";

import type { AnaliseLabItem, AnaliseLabMark } from "@/api/analiseLab";
import type { ProvaWebPageMeta } from "@/api/provaWeb";

import { AnaliseLabProblemBalloon } from "./AnaliseLabProblemBalloon";
import { itemOccurrences } from "./analiseLabComponente";
import {
  buildPageBalloons,
  packBalloons,
} from "./analiseLabBalloons";
import { pageSizeMm } from "./analiseLabGeometry";
import { parsePageSpec } from "./analiseLabPageSpec";

interface AnaliseLabBalloonLayerProps {
  items: AnaliseLabItem[];
  marks: AnaliseLabMark[];
  pages: ProvaWebPageMeta[];
  visiblePages: ProvaWebPageMeta[];
  pageSize: { width: number; height: number };
  slotWidth: number;
  isSpread: boolean;
  flipping: boolean;
  selectedItemId?: number | null;
  dismissedIds: number[];
  onDismiss: (itemId: number) => void;
  onGoToOccurrence: (itemId: number, page: number) => void;
}

const MAX_VISIBLE = 3;
const BALLOON_H = 260;
const GAP = 10;

export function AnaliseLabBalloonLayer({
  items,
  marks,
  pages,
  visiblePages,
  pageSize,
  slotWidth,
  isSpread,
  flipping,
  selectedItemId = null,
  dismissedIds,
  onDismiss,
  onGoToOccurrence,
}: AnaliseLabBalloonLayerProps) {
  const [expanded, setExpanded] = useState(false);

  const anchors = useMemo(() => {
    const all = buildPageBalloons({
      items,
      marks,
      pages,
      visiblePages,
      parsePageSpec,
      pageSizeMm,
    });
    return all.filter((a) => !dismissedIds.includes(a.itemId));
  }, [dismissedIds, items, marks, pages, visiblePages]);

  const pageRects = useMemo(() => {
    const map: Record<
      number,
      {
        left: number;
        top: number;
        width: number;
        height: number;
        widthMm: number;
        heightMm: number;
      }
    > = {};
    if (!visiblePages.length) return map;
    const single = !isSpread || visiblePages.length === 1;
    if (single) {
      const page = visiblePages[0];
      const { widthMm, heightMm } = pageSizeMm(page.widthPt, page.heightPt);
      map[page.page] = {
        left: slotWidth - pageSize.width,
        top: 0,
        width: pageSize.width,
        height: pageSize.height,
        widthMm,
        heightMm,
      };
    } else {
      visiblePages.forEach((page, i) => {
        const { widthMm, heightMm } = pageSizeMm(page.widthPt, page.heightPt);
        map[page.page] = {
          left: i * pageSize.width,
          top: 0,
          width: pageSize.width,
          height: pageSize.height,
          widthMm,
          heightMm,
        };
      });
    }
    return map;
  }, [isSpread, pageSize.height, pageSize.width, slotWidth, visiblePages]);

  const packed = useMemo(
    () =>
      packBalloons(anchors, {
        stageHeight: pageSize.height,
        balloonHeight: BALLOON_H,
        gap: GAP,
        pageRects,
        slotWidth,
      }),
    [anchors, pageRects, pageSize.height, slotWidth],
  );

  if (flipping || !packed.length) return null;

  const visible = expanded ? packed : packed.slice(0, MAX_VISIBLE);
  const overflow = Math.max(0, packed.length - MAX_VISIBLE);

  return (
    <div className="pointer-events-none absolute inset-0 z-20">
      <svg
        className="pointer-events-none absolute inset-0 h-full w-full"
        aria-hidden
      >
        {visible.map((b) => (
          <g key={`line-${b.itemId}-${b.page}`}>
            <line
              x1={b.anchorX}
              y1={b.anchorY}
              x2={b.bubbleX + (b.side === "left" ? 210 : 0)}
              y2={b.bubbleY + 20}
              stroke="#64748b"
              strokeWidth={1.25}
              strokeDasharray="4 3"
            />
            <circle
              cx={b.anchorX}
              cy={b.anchorY}
              r={selectedItemId === b.itemId ? 7 : 5}
              fill={selectedItemId === b.itemId ? "#16a34a" : "#2563eb"}
              fillOpacity={0.9}
            />
            {!b.hasMark ? (
              <text
                x={b.anchorX + 8}
                y={b.anchorY - 6}
                fill="#334155"
                fontSize={11}
                fontWeight={700}
              >
                {b.refNumber}
              </text>
            ) : null}
          </g>
        ))}
      </svg>

      {visible.map((b) => {
        const occ = itemOccurrences(b.item, pages, parsePageSpec);
        const occIdx = Math.max(0, occ.indexOf(b.page));
        return (
          <AnaliseLabProblemBalloon
            key={`ball-${b.itemId}-${b.page}`}
            item={b.item}
            refNumber={b.refNumber}
            highlighted={selectedItemId === b.itemId}
            occurrences={occ}
            occurrenceIndex={occIdx}
            onOccurrenceChange={(idx) => {
              const page = occ[idx];
              if (page) onGoToOccurrence(b.itemId, page);
            }}
            onClose={() => onDismiss(b.itemId)}
            style={{
              position: "absolute",
              left: b.bubbleX,
              top: b.bubbleY,
            }}
          />
        );
      })}

      {!expanded && overflow > 0 ? (
        <button
          type="button"
          className="pointer-events-auto absolute bottom-2 right-2 rounded-full bg-secondary-blue px-2.5 py-1 text-[11px] font-semibold text-white shadow"
          onClick={() => setExpanded(true)}
        >
          +{overflow} problemas
        </button>
      ) : null}
    </div>
  );
}
