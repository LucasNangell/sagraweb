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

const MODEL_PALETTES: Record<string, { bg: string; border: string; accent: string }> = {
  v79: { bg: "#ff9d00", border: "#ffd166", accent: "#fff0b3" },
  v77: { bg: "#18181b", border: "#10b981", accent: "#4ade80" },
  v80: { bg: "#18181b", border: "#ffffff", accent: "#10b981" },
  v81: { bg: "#18181b", border: "#10b981", accent: "#10b981" },
  v37: { bg: "#0f172a", border: "#38bdf8", accent: "#ffffff" },
  "mod-conic-beam": { bg: "#0f172a", border: "#00f2fe", accent: "#4facfe" },
  "mod-kinetic-grad": { bg: "#0a0a0c", border: "#27272a", accent: "#ff007f" },
  "mod-3d-orbit": { bg: "#0f172a", border: "#94a3b8", accent: "#38bdf8" },
  "mod-brutalist": { bg: "#fde047", border: "#09090b", accent: "#ec4899" },
  "mod-terminal": { bg: "#05100a", border: "#10b981", accent: "#10b981" },
  "mod-stroke-wave": { bg: "#13111c", border: "#2e2640", accent: "#a855f7" },
  "mod-cinematic-serif": { bg: "#0c0a09", border: "#78716c", accent: "#fbbf24" },
  "mod-3d-text-extrude": { bg: "#31102f", border: "#db2777", accent: "#f472b6" },
  "mod-aurora": { bg: "#ee7752", border: "#23a6d5", accent: "#e73c7e" },
  "mod-holo-prism": { bg: "#1e293b", border: "#ffffff", accent: "#00ffff" },
  "mod-neumorph": { bg: "#1e293b", border: "#2d3e59", accent: "#38bdf8" },
  "mod-hud": { bg: "#06182a", border: "#06b6d4", accent: "#22d3ee" },
  "mod-slot-text": { bg: "#18181b", border: "#3f3f46", accent: "#fbbf24" },
  "mod-water-mirror": { bg: "#0b1030", border: "#312e81", accent: "#818cf8" },
  "mod-cube-spin": { bg: "#4f46e5", border: "#7c3aed", accent: "#db2777" },
  "mod-liquid-blob": { bg: "#10b981", border: "#047857", accent: "#06b6d4" },
  "mod-anaglyph": { bg: "#09090b", border: "#27272a", accent: "#ff0055" },
  "mod-sonar": { bg: "#0c192c", border: "#1e3a8a", accent: "#3b82f6" },
  "mod-spotlight": { bg: "#050505", border: "#1f1f1f", accent: "#3b82f6" },
  "mod-maglev": { bg: "#18181b", border: "#f43f5e", accent: "#38bdf8" },
  "txt-cyber-slice": { bg: "#090a0f", border: "#1e293b", accent: "#00f0ff" },
  "txt-inferno": { bg: "#0a0200", border: "#450a0a", accent: "#ff8000" },
  "txt-char-wave": { bg: "#111827", border: "#374151", accent: "#38bdf8" },
  "txt-marquee": { bg: "#090d16", border: "#eab308", accent: "#facc15" },
  "txt-vegas-neon": { bg: "#0d0414", border: "#4a044e", accent: "#d946ef" },
  "txt-matrix": { bg: "#000a00", border: "#00ff41", accent: "#00ff41" },
  "txt-ghost-smoke": { bg: "#0f172a", border: "#1e293b", accent: "#f1f5f9" },
  "txt-slingshot": { bg: "#1e1b4b", border: "#4338ca", accent: "#f43f5e" },
  "txt-3d-roller": { bg: "#18181b", border: "#3f3f46", accent: "#a855f7" },
  "txt-xray": { bg: "#090d16", border: "#1e293b", accent: "#00ffcc" },
};

const LEGACY_SUFFIX: Record<string, { bg: string; border: string; accent: string }> = {
  amber: { bg: "#ff9d00", border: "#ffd166", accent: "#fff0b3" },
  darkgray: { bg: "#18181b", border: "#10b981", accent: "#4ade80" },
  red: { bg: "#b91c1c", border: "#fecaca", accent: "#fde047" },
};

function hex(value: unknown): string {
  const text = String(value ?? "").trim();
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(text) ? text : "";
}

function paletteFor(effect: unknown): { bg: string; border: string; accent: string } | null {
  const id = String(effect ?? "").trim();
  if (!id) return null;
  const legacy = /^(v\d+)-(amber|darkgray|red)$/i.exec(id);
  if (legacy) return LEGACY_SUFFIX[legacy[2].toLowerCase()] ?? null;
  return MODEL_PALETTES[id] ?? null;
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
  const rawValue = models?.[key];
  const raw = typeof rawValue === "string" ? { effect: rawValue } : asRecord(rawValue);
  const colors = asRecord(raw?.colors) as ColorMap | null;
  const pal = paletteFor(raw?.effect ?? (typeof rawValue === "string" ? rawValue : ""));
  const priorities = asRecord(typography?.priorities);
  const pri = asRecord(priorities?.[key]) as ColorMap | null;
  const heading = asRecord(typography?.heading);
  return {
    bg: hex(colors?.bg) || pal?.bg || "",
    border: hex(colors?.border) || pal?.border || "",
    accent: hex(colors?.accent) || pal?.accent || "",
    title: hex(pri?.titleColor) || hex(typography?.titleColor) || hex(heading?.color),
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
