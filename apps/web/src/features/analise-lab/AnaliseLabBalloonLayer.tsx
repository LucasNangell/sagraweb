import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { AnaliseLabItem, AnaliseLabMark } from "@/api/analiseLab";
import type { ProvaWebPageMeta } from "@/api/provaWeb";

import { AnaliseLabProblemBalloon } from "./AnaliseLabProblemBalloon";
import {
  buildPageBalloons,
  itemBalloonOccurrencePages,
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
  gutterRight?: number;
  isSpread: boolean;
  flipping: boolean;
  selectedItemId?: number | null;
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
  gutterRight = 280,
  isSpread,
  flipping,
  selectedItemId = null,
  dismissedIds,
  onDismiss,
  onGoToOccurrence,
  pageRectsOverride,
}: AnaliseLabBalloonLayerProps) {
  const [expanded, setExpanded] = useState(false);
  const [heightsByItemId, setHeightsByItemId] = useState<
    Record<number, number>
  >({});
  const observersRef = useRef<Map<number, ResizeObserver>>(new Map());

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

  const packed = useMemo(
    () =>
      packBalloons(anchors, {
        stageHeight,
        balloonHeight: BALLOON_H,
        gap: GAP,
        pageRects,
        slotWidth,
        gutterRight,
        heightsByItemId,
      }),
    [anchors, gutterRight, heightsByItemId, pageRects, slotWidth, stageHeight],
  );

  const visible = expanded ? packed : packed.slice(0, MAX_VISIBLE);
  const overflow = Math.max(0, packed.length - MAX_VISIBLE);
  const visibleIdsKey = visible.map((b) => b.itemId).join(",");

  useEffect(() => {
    const keep = new Set(
      visibleIdsKey
        ? visibleIdsKey.split(",").map((id) => Number(id))
        : [],
    );
    setHeightsByItemId((prev) => {
      let changed = false;
      const next: Record<number, number> = {};
      for (const [key, value] of Object.entries(prev)) {
        const id = Number(key);
        if (keep.has(id)) next[id] = value;
        else changed = true;
      }
      return changed ? next : prev;
    });
    for (const [id, observer] of observersRef.current) {
      if (!keep.has(id)) {
        observer.disconnect();
        observersRef.current.delete(id);
      }
    }
  }, [visibleIdsKey]);

  useEffect(() => {
    return () => {
      for (const observer of observersRef.current.values()) {
        observer.disconnect();
      }
      observersRef.current.clear();
    };
  }, []);

  const setBalloonNodeRef = useCallback(
    (itemId: number, el: HTMLDivElement | null) => {
      const prev = observersRef.current.get(itemId);
      if (prev) {
        prev.disconnect();
        observersRef.current.delete(itemId);
      }
      if (!el) return;

      const recordHeight = () => {
        const h = el.offsetHeight;
        setHeightsByItemId((prevHeights) => {
          if (prevHeights[itemId] === h) return prevHeights;
          return { ...prevHeights, [itemId]: h };
        });
      };

      const ro = new ResizeObserver(recordHeight);
      ro.observe(el);
      observersRef.current.set(itemId, ro);
      recordHeight();
    },
    [],
  );

  if (flipping || !packed.length) return null;

  return (
    <div
      className="pointer-events-none absolute inset-0 z-20"
      style={{ right: -gutterRight }}
    >
      <svg
        className="pointer-events-none absolute inset-0 h-full w-full"
        aria-hidden
      >
        {visible.map((b) =>
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

      {visible.map((b) => {
        const occ = itemBalloonOccurrencePages(
          b.item,
          marks,
          pages,
          parsePageSpec,
        );
        const occIdx = Math.max(0, occ.indexOf(b.page));
        return (
          <AnaliseLabProblemBalloon
            key={`ball-${b.itemId}`}
            ref={(el) => setBalloonNodeRef(b.itemId, el)}
            item={b.item}
            refNumber={b.refNumber}
            width={b.balloonWidth}
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
          className="pointer-events-auto absolute bottom-2 rounded-full bg-secondary-blue px-2.5 py-1 text-[11px] font-semibold text-white shadow"
          style={{ right: 8 }}
          onClick={() => setExpanded(true)}
        >
          +{overflow} problemas
        </button>
      ) : null}
    </div>
  );
}
