import { useMemo, useRef, useState } from "react";

import type { AnaliseLabItem, AnaliseLabMark } from "@/api/analiseLab";
import type { ProvaWebPageMeta } from "@/api/provaWeb";

import { AnaliseLabProblemBalloon } from "./AnaliseLabProblemBalloon";
import {
  BALLOON_EXPAND_H,
  BALLOON_PREFERRED_H,
  buildPageBalloons,
  computeFitBalloonHeight,
  itemBalloonOccurrencePages,
  occurrenceIndexForActivePage,
  packBalloons,
  type PackedBalloon,
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
  gutterRight?: number;
  isSpread: boolean;
  flipping: boolean;
  selectedItemId?: number | null;
  /** Página atual do Folhear (para o contador 1/N do balão). */
  activePage?: number;
  dismissedIds: number[];
  onDismiss: (itemId: number) => void;
  onGoToOccurrence: (itemId: number, page: number) => void;
  /** Se informado (ex.: Folhear folhas), usa posições medidas em vez do layout do flipbook. */
  pageRectsOverride?: Record<
    number,
    {
      left: number;
      top: number;
      width: number;
      height: number;
      widthMm: number;
      heightMm: number;
    }
  >;
}

const GAP = 8;

export function AnaliseLabBalloonLayer({
  items,
  marks,
  pages,
  visiblePages,
  pageSize,
  slotWidth,
  gutterRight = 280,
  isSpread,
  flipping,
  selectedItemId = null,
  activePage,
  dismissedIds,
  onDismiss,
  onGoToOccurrence,
  pageRectsOverride,
}: AnaliseLabBalloonLayerProps) {
  const [hoveredItemId, setHoveredItemId] = useState<number | null>(null);

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
    if (pageRectsOverride) return pageRectsOverride;
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
  }, [
    isSpread,
    pageRectsOverride,
    pageSize.height,
    pageSize.width,
    slotWidth,
    visiblePages,
  ]);

  const stageHeight = useMemo(() => {
    if (pageRectsOverride) {
      const bottoms = Object.values(pageRectsOverride).map(
        (r) => r.top + r.height,
      );
      return Math.max(pageSize.height, ...bottoms, 1);
    }
    return pageSize.height;
  }, [pageRectsOverride, pageSize.height]);

  const fitHeight = useMemo(
    () =>
      computeFitBalloonHeight(
        stageHeight,
        anchors.length,
        GAP,
        BALLOON_PREFERRED_H,
      ),
    [anchors.length, stageHeight],
  );

  const packed = useMemo(
    () =>
      packBalloons(anchors, {
        stageHeight,
        balloonHeight: BALLOON_PREFERRED_H,
        gap: GAP,
        pageRects,
        slotWidth,
        gutterRight,
        fitToStage: true,
      }),
    [anchors, gutterRight, pageRects, slotWidth, stageHeight],
  );

  // Congela o layout durante a animação do flipbook para o balão não piscar
  // quando o mesmo problema continua na página seguinte.
  const stableLayoutRef = useRef<{
    packed: PackedBalloon[];
    fitHeight: number;
  }>({ packed: [], fitHeight: BALLOON_PREFERRED_H });
  if (!flipping) {
    stableLayoutRef.current = { packed, fitHeight };
  }
  const displayPacked = flipping ? stableLayoutRef.current.packed : packed;
  const displayFit = flipping ? stableLayoutRef.current.fitHeight : fitHeight;

  if (!displayPacked.length) return null;

  return (
    <div
      className="pointer-events-none absolute inset-0 z-20"
      style={{ right: -gutterRight }}
    >
      {!flipping ? (
        <svg
          className="pointer-events-none absolute inset-0 h-full w-full"
          aria-hidden
        >
          {displayPacked.map((b) =>
            b.leaders.map((leader) => (
              <g key={`line-${b.itemId}-${leader.markId}`}>
                <line
                  x1={leader.anchorX}
                  y1={leader.anchorY}
                  x2={b.bubbleX}
                  y2={b.bubbleY + 20}
                  stroke="#64748b"
                  strokeWidth={1.25}
                  strokeDasharray="4 3"
                />
                <circle
                  cx={leader.anchorX}
                  cy={leader.anchorY}
                  r={selectedItemId === b.itemId ? 7 : 5}
                  fill={selectedItemId === b.itemId ? "#16a34a" : "#2563eb"}
                  fillOpacity={0.9}
                />
              </g>
            )),
          )}
        </svg>
      ) : null}

      {displayPacked.map((b, stackIndex) => {
        const occ = itemBalloonOccurrencePages(
          b.item,
          marks,
          pages,
          parsePageSpec,
        );
        const occIdx = occurrenceIndexForActivePage(
          occ,
          activePage ?? b.page,
          visiblePages.map((p) => p.page),
          b.page,
        );
        // Só hover/focus sobe e expande — seleção destaca sem sobrepor vizinhos.
        const raised = hoveredItemId === b.itemId;
        return (
          <AnaliseLabProblemBalloon
            key={`ball-${b.itemId}`}
            item={b.item}
            refNumber={b.refNumber}
            width={b.balloonWidth}
            highlighted={selectedItemId === b.itemId}
            collapsed={!raised}
            restHeight={displayFit}
            expandHeight={BALLOON_EXPAND_H}
            stackIndex={stackIndex}
            occurrences={occ}
            occurrenceIndex={occIdx}
            onOccurrenceChange={(idx) => {
              const page = occ[idx];
              if (page) onGoToOccurrence(b.itemId, page);
            }}
            onClose={() => onDismiss(b.itemId)}
            onHoverChange={(active) =>
              setHoveredItemId(active ? b.itemId : null)
            }
            style={{
              position: "absolute",
              left: b.bubbleX,
              top: b.bubbleY,
              zIndex: raised ? 1000 : 10 + stackIndex,
            }}
          />
        );
      })}
    </div>
  );
}
