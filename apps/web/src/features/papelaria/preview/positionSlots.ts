import type { PapelariaPreviewTextElement } from "./types";

export const PREVIEW_POSITION_SLOTS = [
  { id: "top-left", label: "Superior esquerdo" },
  { id: "top-center", label: "Superior centro" },
  { id: "top-right", label: "Superior direito" },
  { id: "center-left", label: "Centro esquerdo" },
  { id: "center", label: "Centro" },
  { id: "center-right", label: "Centro direito" },
  { id: "bottom-left", label: "Inferior esquerdo" },
  { id: "bottom-center", label: "Inferior centro" },
  { id: "bottom-right", label: "Inferior direito" },
] as const;

export type PreviewPositionSlotId = (typeof PREVIEW_POSITION_SLOTS)[number]["id"];

const SLOT_ANCHORS: Record<
  PreviewPositionSlotId,
  { xPct: number; yPct: number; align: PapelariaPreviewTextElement["align"]; anchor: PapelariaPreviewTextElement["anchor"] }
> = {
  "top-left": { xPct: 0.08, yPct: 0.1, align: "left", anchor: "start" },
  "top-center": { xPct: 0.5, yPct: 0.1, align: "center", anchor: "start" },
  "top-right": { xPct: 0.92, yPct: 0.1, align: "right", anchor: "start" },
  "center-left": { xPct: 0.08, yPct: 0.5, align: "left", anchor: "middle" },
  center: { xPct: 0.5, yPct: 0.5, align: "center", anchor: "middle" },
  "center-right": { xPct: 0.92, yPct: 0.5, align: "right", anchor: "middle" },
  "bottom-left": { xPct: 0.08, yPct: 0.9, align: "left", anchor: "end" },
  "bottom-center": { xPct: 0.5, yPct: 0.9, align: "center", anchor: "end" },
  "bottom-right": { xPct: 0.92, yPct: 0.9, align: "right", anchor: "end" },
};

export function isPreviewPositionSlotId(value: string): value is PreviewPositionSlotId {
  return value in SLOT_ANCHORS;
}

export function slotToElementRect(
  slotId: PreviewPositionSlotId,
  canvasW: number,
  canvasH: number,
  width = 400,
  height = 48,
): Pick<PapelariaPreviewTextElement, "x" | "y" | "width" | "height" | "align" | "anchor"> {
  const slot = SLOT_ANCHORS[slotId];
  const xCenter = canvasW * slot.xPct;
  const yCenter = canvasH * slot.yPct;
  let x = xCenter - width / 2;
  if (slot.align === "left") x = canvasW * slot.xPct;
  if (slot.align === "right") x = canvasW * slot.xPct - width;

  let y = yCenter;
  if (slot.anchor === "start") y = canvasH * slot.yPct;
  if (slot.anchor === "middle") y = yCenter - height / 2;
  if (slot.anchor === "end") y = canvasH * slot.yPct - height;

  return {
    x: Math.round(Math.max(0, Math.min(x, canvasW - width))),
    y: Math.round(Math.max(0, Math.min(y, canvasH - height))),
    width,
    height,
    align: slot.align,
    anchor: slot.anchor,
  };
}

export function nearestPreviewPositionSlot(
  x: number,
  y: number,
  canvasW: number,
  canvasH: number,
  allowedSlots?: PreviewPositionSlotId[],
): PreviewPositionSlotId {
  const candidates =
    allowedSlots && allowedSlots.length > 0
      ? PREVIEW_POSITION_SLOTS.filter((s) => allowedSlots.includes(s.id))
      : PREVIEW_POSITION_SLOTS;

  let best: PreviewPositionSlotId = candidates[0]?.id ?? "center";
  let bestDist = Number.POSITIVE_INFINITY;
  for (const slot of candidates) {
    const anchor = SLOT_ANCHORS[slot.id];
    const ax = canvasW * anchor.xPct;
    const ay = canvasH * anchor.yPct;
    const dist = (ax - x) ** 2 + (ay - y) ** 2;
    if (dist < bestDist) {
      bestDist = dist;
      best = slot.id;
    }
  }
  return best;
}

export function defaultSlotForTemplate(
  posicoesPermitidas?: PreviewPositionSlotId[],
  fallback?: PreviewPositionSlotId,
): PreviewPositionSlotId {
  if (posicoesPermitidas?.length) return posicoesPermitidas[0]!;
  if (fallback && isPreviewPositionSlotId(fallback)) return fallback;
  return "center";
}
