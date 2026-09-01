import type { TourPlacement } from "./types";

export interface TourHole {
  top: number;
  left: number;
  width: number;
  height: number;
}

const GAP = 12;
const MARGIN = 8;

export function inflateHole(rect: DOMRect, pad = 8): TourHole {
  return {
    top: rect.top - pad,
    left: rect.left - pad,
    width: rect.width + pad * 2,
    height: rect.height + pad * 2,
  };
}

export type TourArrowSide = "top" | "bottom" | "left" | "right" | "none";

export function computePopoverPosition(
  hole: TourHole | null,
  popover: { width: number; height: number },
  placement: TourPlacement,
  viewport: { width: number; height: number },
): { top: number; left: number; arrowSide: TourArrowSide } {
  if (!hole || placement === "center") {
    return {
      top: Math.max(MARGIN, (viewport.height - popover.height) / 2),
      left: Math.max(MARGIN, (viewport.width - popover.width) / 2),
      arrowSide: "none",
    };
  }

  let top = 0;
  let left = 0;
  let arrowSide: TourArrowSide = "top";

  if (placement === "bottom") {
    top = hole.top + hole.height + GAP;
    left = hole.left + hole.width / 2 - popover.width / 2;
    arrowSide = "top";
  } else if (placement === "top") {
    top = hole.top - GAP - popover.height;
    left = hole.left + hole.width / 2 - popover.width / 2;
    arrowSide = "bottom";
  } else if (placement === "left") {
    top = hole.top + hole.height / 2 - popover.height / 2;
    left = hole.left - GAP - popover.width;
    arrowSide = "right";
  } else {
    top = hole.top + hole.height / 2 - popover.height / 2;
    left = hole.left + hole.width + GAP;
    arrowSide = "left";
  }

  const maxLeft = viewport.width - popover.width - MARGIN;
  const maxTop = viewport.height - popover.height - MARGIN;
  left = Math.min(Math.max(MARGIN, left), Math.max(MARGIN, maxLeft));
  top = Math.min(Math.max(MARGIN, top), Math.max(MARGIN, maxTop));

  return { top, left, arrowSide };
}
