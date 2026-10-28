export const CLASSIC_ENTRY_ANIMATIONS = [
  { id: "fx-iris", label: "25. Íris Portal" },
  { id: "fx-stage-build", label: "26. Construção 2 estágios" },
  { id: "fx-glitch", label: "27. Glitch RGB" },
  { id: "fx-rubber", label: "28. Impacto elástico" },
  { id: "fx-origami", label: "29. Corte diagonal" },
  { id: "fx-laser", label: "30. Laser reconstrutor" },
  { id: "fx-isometric", label: "31. Pouso isométrico" },
  { id: "fx-crt", label: "32. Ignição CRT" },
  { id: "fx-supernova", label: "33. Supernova" },
  { id: "fx-stagger", label: "34. Cascata interna" },
  { id: "fx-shutter", label: "35. Obturador" },
  { id: "fx-warp", label: "36. Dobra espacial" },
] as const;

export const DEFAULT_ENTRY_ANIMATION = "fx-iris";

export type NotificationSlotStyle = {
  bg?: string;
  border?: string;
  accent?: string;
  title?: string;
  situation?: string;
};

export type NotificationVisual = {
  presetId?: number;
  presetName?: string;
  fontScale?: number;
  high?: NotificationSlotStyle;
  medium?: NotificationSlotStyle;
  normal?: NotificationSlotStyle;
};

type ColorMap = { bg?: string; border?: string; accent?: string; titleColor?: string; situationColor?: string };

function hex(value: unknown): string {
  const text = String(value ?? "").trim();
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(text) ? text : "";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function slotOf(
  models: Record<string, unknown> | null,
  typography: Record<string, unknown> | null,
  key: "high" | "medium" | "normal",
): NotificationSlotStyle {
  const raw = asRecord(models?.[key]);
  const colors = asRecord(raw?.colors) as ColorMap | null;
  const priorities = asRecord(typography?.priorities);
  const pri = asRecord(priorities?.[key]) as ColorMap | null;
  return {
    bg: hex(colors?.bg),
    border: hex(colors?.border),
    accent: hex(colors?.accent),
    title: hex(pri?.titleColor) || hex(typography?.titleColor),
    situation: hex(pri?.situationColor) || hex(typography?.situationColor),
  };
}

/** Visual do preset sem animação de entrada (essa fica nos Ajustes). */
export function visualFromPreset(payload: unknown, id: number, name: string): NotificationVisual {
  const root = asRecord(payload) ?? {};
  const style = asRecord(root.cardStyle) ?? (asRecord(root.models) ? root : {});
  const models = asRecord(style.models);
  const typography = asRecord(style.typography);
  const scale = Number(typography?.fontScale);
  return {
    presetId: id,
    presetName: name,
    fontScale: Number.isFinite(scale) && scale > 0 ? scale : 1,
    high: slotOf(models, typography, "high"),
    medium: slotOf(models, typography, "medium"),
    normal: slotOf(models, typography, "normal"),
  };
}

export function clampEntryAnimation(value: unknown): string {
  const id = String(value ?? "").trim();
  return CLASSIC_ENTRY_ANIMATIONS.some((item) => item.id === id) ? id : DEFAULT_ENTRY_ANIMATION;
}
