import type { DashboardCardColors } from "@/features/dashboard-setor/types";

import { CARD_MODEL_MAP, type CardModelPalette } from "./cardModels";
import {
  ENTRY_ANIMATIONS,
  HIGHLIGHT_ANIMATIONS,
} from "./entryAnimations";

export interface ColorSwatch {
  key: string;
  label: string;
  value: string;
}

const BASE: Array<{ key: keyof CardModelPalette; label: string }> = [
  { key: "bg", label: "Fundo" },
  { key: "border", label: "Borda" },
  { key: "accent", label: "Destaque" },
];

/** Cores extras originais do catálogo (além de fundo/borda/destaque). */
const EXTRA_SWATCHES: Record<string, ColorSwatch[]> = {
  "lab-vidro-fosco": [{ key: "extra", label: "Carimbo", value: "#ff657a" }],
  v79: [{ key: "text", label: "Texto", value: "#0b0f19" }],
  "mod-kinetic-grad": [
    { key: "extra", label: "Violeta", value: "#7928ca" },
    { key: "extra2", label: "Ciano", value: "#00d4ff" },
  ],
  "mod-aurora": [{ key: "extra", label: "Verde-água", value: "#23d5ab" }],
  "mod-holo-prism": [{ key: "extra", label: "Reflexo", value: "#ff0080" }],
  "mod-anaglyph": [{ key: "extra", label: "Ciano 3D", value: "#00ffff" }],
  "txt-cyber-slice": [{ key: "extra", label: "Fatia vermelha", value: "#ff003c" }],
  "txt-vegas-neon": [{ key: "extra", label: "Brilho", value: "#ffffff" }],
  "fx-laser": [
    { key: "accent", label: "Feixe", value: "#ffffff" },
    { key: "border", label: "Halo", value: "#38bdf8" },
  ],
  "fx-glitch": [
    { key: "accent", label: "Magenta", value: "#ff0055" },
    { key: "extra", label: "Ciano", value: "#00ffff" },
  ],
  "fx-cyber-slice": [
    { key: "accent", label: "Fatia ciano", value: "#00f0ff" },
    { key: "extra", label: "Fatia vermelha", value: "#ff003c" },
  ],
  "fx-inferno": [
    { key: "accent", label: "Chama", value: "#ff8000" },
    { key: "extra", label: "Brasa", value: "#ff0000" },
  ],
  "fx-vegas-neon": [{ key: "accent", label: "Neon", value: "#d946ef" }],
  "fx-matrix": [{ key: "accent", label: "Verde matrix", value: "#00ff41" }],
  "fx-xray": [{ key: "accent", label: "Varredura", value: "#00ffcc" }],
  "fx-slingshot": [{ key: "accent", label: "Esticada", value: "#f43f5e" }],
  "fx-3d-roller": [{ key: "accent", label: "Face 2", value: "#a855f7" }],
  "fx-meteor": [{ key: "accent", label: "Impacto", value: "#f97316" }],
  "fx-tesla": [
    { key: "bg", label: "Fundo", value: "#060b19" },
    { key: "border", label: "Borda", value: "#38bdf8" },
    { key: "accent", label: "Descarga", value: "#00ffff" },
  ],
  "fx-nuclear": [
    { key: "bg", label: "Fundo", value: "#1a1600" },
    { key: "border", label: "Borda", value: "#eab308" },
    { key: "accent", label: "Alerta", value: "#ef4444" },
  ],
  "fx-gold-vip": [
    { key: "bg", label: "Ouro escuro", value: "#422006" },
    { key: "border", label: "Borda", value: "#fde047" },
    { key: "accent", label: "Brilho", value: "#fef08a" },
  ],
  "fx-siren": [
    { key: "bg", label: "Fundo", value: "#0f172a" },
    { key: "accent", label: "Vermelho", value: "#ef4444" },
    { key: "extra", label: "Azul", value: "#3b82f6" },
  ],
  "fx-heartbeat": [
    { key: "bg", label: "Fundo", value: "#2a0a18" },
    { key: "accent", label: "Pulso", value: "#f43f5e" },
  ],
  "fx-twin-laser": [
    { key: "accent", label: "Laser A", value: "#ff0055" },
    { key: "extra", label: "Laser B", value: "#00ffcc" },
  ],
  "fx-forcefield": [
    { key: "bg", label: "Fundo", value: "#042f2e" },
    { key: "border", label: "Borda", value: "#2dd4bf" },
    { key: "accent", label: "Campo", value: "#14b8a6" },
  ],
  "fx-stamp": [{ key: "accent", label: "Carimbo", value: "#ef4444" }],
  "fx-crystal": [
    { key: "bg", label: "Fundo", value: "#2e1065" },
    { key: "accent", label: "Brilho", value: "#e879f9" },
  ],
  "fx-solar-flare": [
    { key: "bg", label: "Núcleo", value: "#7c2d12" },
    { key: "border", label: "Borda", value: "#f97316" },
    { key: "accent", label: "Coroa", value: "#fde047" },
  ],
  "fx-blackhole": [
    { key: "bg", label: "Núcleo", value: "#4c1d95" },
    { key: "border", label: "Borda", value: "#8b5cf6" },
  ],
  "fx-teleport": [
    { key: "bg", label: "Fundo", value: "#042f2e" },
    { key: "accent", label: "Feixe", value: "#00ffff" },
  ],
};

function fromPalette(palette: CardModelPalette, extras: ColorSwatch[] = []): ColorSwatch[] {
  return [
    ...BASE.map((item) => ({
      key: item.key,
      label: item.label,
      value: palette[item.key],
    })),
    ...extras,
  ];
}

function uniqueSwatches(list: ColorSwatch[]): ColorSwatch[] {
  const seen = new Set<string>();
  const next: ColorSwatch[] = [];
  for (const item of list) {
    if (seen.has(item.key)) {
      continue;
    }
    seen.add(item.key);
    next.push(item);
  }
  return next;
}

/** Cores originais do catálogo para um efeito visual. */
export function modelSwatches(modelId: string): ColorSwatch[] {
  const model = CARD_MODEL_MAP.get(modelId);
  if (!model) {
    return [];
  }
  return uniqueSwatches(fromPalette(model.palette, EXTRA_SWATCHES[modelId]));
}

/** Cores originais do catálogo para uma animação de entrada ou realce. */
export function animationSwatches(animationId: string): ColorSwatch[] {
  if (!animationId || animationId === "none") {
    return [];
  }
  const extras = EXTRA_SWATCHES[animationId];
  if (extras?.length) {
    return uniqueSwatches(extras);
  }
  const known = [...ENTRY_ANIMATIONS, ...HIGHLIGHT_ANIMATIONS].some(
    (item) => item.id === animationId,
  );
  return known ? [] : [];
}

export function colorsFromSwatches(
  swatches: ColorSwatch[],
): DashboardCardColors | undefined {
  const next: DashboardCardColors = {};
  for (const item of swatches) {
    next[item.key] = item.value;
  }
  return Object.keys(next).length > 0 ? next : undefined;
}

export function mergeSwatchValues(
  swatches: ColorSwatch[],
  current: DashboardCardColors | undefined,
): ColorSwatch[] {
  return swatches.map((item) => ({
    ...item,
    value: current?.[item.key] || item.value,
  }));
}

export function cssVarsFromColors(
  colors: DashboardCardColors | null | undefined,
  prefix: "--cm" | "--fx",
): Record<string, string> {
  const vars: Record<string, string> = {};
  if (!colors) {
    return vars;
  }
  for (const [key, value] of Object.entries(colors)) {
    if (value) {
      vars[`${prefix}-${key}`] = value;
    }
  }
  return vars;
}
