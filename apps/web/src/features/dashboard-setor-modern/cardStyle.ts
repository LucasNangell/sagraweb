import type { CSSProperties } from "react";

import type {
  DashboardCardColors,
  DashboardCardSlot,
  DashboardCardStyle,
  DashboardCardTextColors,
  DashboardCardTypography,
  DashboardColumnConfig,
  DashboardConfig,
  DashboardPriorityType,
  DashboardTextStyle,
  DashboardTheme,
} from "@/features/dashboard-setor/types";

import { isCardModelId, migrateLegacyModelId } from "./cardModels";
import {
  isEntryAnimationId,
  isHighlightAnimationId,
} from "./entryAnimations";

/** Paletas iniciais sugeridas por prioridade (pré-preenchem os seletores de cor). */
export const DEFAULT_SLOT_COLORS: Record<
  "high" | "medium" | "normal",
  DashboardCardColors
> = {
  high: { bg: "#b91c1c", border: "#fecaca", accent: "#fde047" },
  medium: { bg: "#ff9d00", border: "#ffd166", accent: "#fff0b3" },
  normal: { bg: "#17212e", border: "#2a3748", accent: "#72ddc3" },
};

export const CARD_FONT_OPTIONS = [
  { id: "", label: "Padrão do painel (Inter)", stack: "" },
  {
    id: "inter",
    label: "Inter",
    stack: 'Inter, ui-sans-serif, system-ui, sans-serif',
  },
  {
    id: "space-grotesk",
    label: "Space Grotesk",
    stack: '"Space Grotesk", ui-sans-serif, system-ui, sans-serif',
  },
  {
    id: "orbitron",
    label: "Orbitron",
    stack: 'Orbitron, ui-sans-serif, system-ui, sans-serif',
  },
  {
    id: "syne",
    label: "Syne",
    stack: 'Syne, ui-sans-serif, system-ui, sans-serif',
  },
  {
    id: "jetbrains-mono",
    label: "JetBrains Mono",
    stack: '"JetBrains Mono", ui-monospace, monospace',
  },
  {
    id: "system",
    label: "Sistema",
    stack: "system-ui, sans-serif",
  },
] as const;

export const DEFAULT_CARD_STYLE: DashboardCardStyle = {
  models: {
    high: { effect: "" },
    medium: { effect: "" },
    normal: { effect: "" },
  },
  entryAnimation: "none",
  entrySpeed: 1,
};

function clipText(value: unknown, max: number): string {
  return String(value ?? "").trim().slice(0, max);
}

function asColor(value: unknown): string {
  const text = clipText(value, 32);
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(text)
    ? text
    : "";
}

function asFontStack(value: unknown): string {
  const text = clipText(value, 160);
  const known = CARD_FONT_OPTIONS.find(
    (item) => item.id === text || item.stack === text,
  );
  if (known) {
    return known.stack;
  }
  return "";
}

function asScale(value: unknown): number | undefined {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) {
    return undefined;
  }
  return Math.min(1.8, Math.max(0.7, Math.round(n * 100) / 100));
}

function asSpacing(value: unknown): number | undefined {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) {
    return undefined;
  }
  return Math.min(0.2, Math.max(-0.12, Math.round(n * 1000) / 1000));
}

function asSpeed(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    return 1;
  }
  return Math.min(3, Math.max(0.4, Math.round(n * 10) / 10));
}

function asModelId(value: unknown): string {
  const id = clipText(value, 32);
  return isCardModelId(id) ? id : "";
}

function asTextColors(raw: unknown): DashboardCardTextColors | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const parsed = raw as DashboardCardTextColors;
  const titleColor = asColor(parsed.titleColor);
  const situationColor = asColor(parsed.situationColor);
  const authorColor = asColor(parsed.authorColor);
  const timerColor = asColor(parsed.timerColor);
  const next: DashboardCardTextColors = {
    ...(titleColor ? { titleColor } : {}),
    ...(situationColor ? { situationColor } : {}),
    ...(authorColor ? { authorColor } : {}),
    ...(timerColor ? { timerColor } : {}),
  };
  return Object.keys(next).length > 0 ? next : undefined;
}

function asColors(raw: unknown): DashboardCardColors | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const next: DashboardCardColors = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!/^[a-z][a-z0-9-]{0,23}$/.test(key)) {
      continue;
    }
    const color = asColor(value);
    if (color) {
      next[key] = color;
    }
  }
  return Object.keys(next).length > 0 ? next : undefined;
}

/** Aceita o formato novo (`{ effect, colors }`) e o legado (`"v79-amber"`). */
function asSlot(raw: unknown): DashboardCardSlot {
  if (typeof raw === "string") {
    const legacy = migrateLegacyModelId(raw);
    if (legacy) {
      return { effect: legacy.effect, colors: legacy.palette };
    }
    return { effect: asModelId(raw) };
  }
  if (raw && typeof raw === "object") {
    const parsed = raw as DashboardCardSlot;
    const effect = asModelId(parsed.effect);
    const colors = asColors(parsed.colors);
    const highlight = asHighlightId(parsed.highlight);
    const highlightColors = asColors(parsed.highlightColors);
    return {
      effect,
      ...(colors ? { colors } : {}),
      ...(highlight ? { highlight } : {}),
      ...(highlightColors ? { highlightColors } : {}),
    };
  }
  return { effect: "" };
}

function asEntryId(value: unknown): string {
  const id = clipText(value, 32);
  if (!id || id === "none") {
    return "none";
  }
  return isEntryAnimationId(id) ? id : "none";
}

function asHighlightId(value: unknown): string {
  const id = clipText(value, 32);
  if (!id || id === "none") {
    return "";
  }
  return isHighlightAnimationId(id) ? id : "";
}

function normalizeTextStyle(
  raw: unknown,
  defaultSpacing: number,
): DashboardTextStyle | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const parsed = raw as DashboardTextStyle;
  const fontFamily = asFontStack(parsed.fontFamily);
  const fontScale = asScale(parsed.fontScale);
  const letterSpacing = asSpacing(parsed.letterSpacing);
  const color = asColor(parsed.color);
  const next: DashboardTextStyle = {
    ...(fontFamily ? { fontFamily } : {}),
    ...(fontScale != null && fontScale !== 1 ? { fontScale } : {}),
    ...(letterSpacing != null && letterSpacing !== defaultSpacing
      ? { letterSpacing }
      : {}),
    ...(color ? { color } : {}),
  };
  return Object.keys(next).length > 0 ? next : undefined;
}

export function normalizeCardStyle(raw: unknown): DashboardCardStyle | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const parsed = raw as Partial<DashboardCardStyle> & {
    models?: Partial<DashboardCardStyle["models"]>;
    typography?: DashboardCardTypography;
  };
  const models = {
    high: asSlot(parsed.models?.high),
    medium: asSlot(parsed.models?.medium),
    normal: asSlot(parsed.models?.normal),
  };
  const entryAnimation = asEntryId(parsed.entryAnimation);
  const entryColors = asColors(
    (parsed as DashboardCardStyle).entryColors,
  );
  const entrySpeed = asSpeed(parsed.entrySpeed);
  const fontFamily = asFontStack(parsed.typography?.fontFamily);
  const fontScale = asScale(parsed.typography?.fontScale);
  const titleScale = asScale(parsed.typography?.titleScale);
  const situationScale = asScale(parsed.typography?.situationScale);
  const authorScale = asScale(parsed.typography?.authorScale);
  const timerScale = asScale(parsed.typography?.timerScale);
  const letterSpacing = asSpacing(parsed.typography?.letterSpacing);
  const titleColor = asColor(parsed.typography?.titleColor);
  const situationColor = asColor(parsed.typography?.situationColor);
  const highText = asTextColors(parsed.typography?.priorities?.high);
  const mediumText = asTextColors(parsed.typography?.priorities?.medium);
  const normalText = asTextColors(parsed.typography?.priorities?.normal);
  const priorities =
    highText || mediumText || normalText
      ? {
          ...(highText ? { high: highText } : {}),
          ...(mediumText ? { medium: mediumText } : {}),
          ...(normalText ? { normal: normalText } : {}),
        }
      : undefined;
  const heading = normalizeTextStyle(parsed.typography?.heading, -0.045);
  const column = normalizeTextStyle(parsed.typography?.column, -0.02);
  const typography: DashboardCardTypography = {
    ...(fontFamily ? { fontFamily } : {}),
    ...(fontScale != null && fontScale !== 1 ? { fontScale } : {}),
    ...(titleScale != null && titleScale !== 1 ? { titleScale } : {}),
    ...(situationScale != null && situationScale !== 1
      ? { situationScale }
      : {}),
    ...(authorScale != null && authorScale !== 1 ? { authorScale } : {}),
    ...(timerScale != null && timerScale !== 1 ? { timerScale } : {}),
    ...(letterSpacing != null && letterSpacing !== -0.045
      ? { letterSpacing }
      : {}),
    ...(titleColor ? { titleColor } : {}),
    ...(situationColor ? { situationColor } : {}),
    ...(priorities ? { priorities } : {}),
    ...(heading ? { heading } : {}),
    ...(column ? { column } : {}),
  };
  const hasModels = Boolean(
    models.high.effect ||
      models.medium.effect ||
      models.normal.effect ||
      models.high.highlight ||
      models.medium.highlight ||
      models.normal.highlight,
  );
  const hasTypo = Object.keys(typography).length > 0;
  if (
    !hasModels &&
    entryAnimation === "none" &&
    entrySpeed === 1 &&
    !hasTypo &&
    !entryColors
  ) {
    return undefined;
  }
  return {
    models,
    entryAnimation,
    ...(entryColors ? { entryColors } : {}),
    ...(entrySpeed !== 1 ? { entrySpeed } : {}),
    ...(hasTypo ? { typography } : {}),
  };
}

export function resolveCardSlot(
  style: DashboardCardStyle | undefined,
  priority: DashboardPriorityType,
): DashboardCardSlot | null {
  if (!style) {
    return null;
  }
  const slot =
    priority === "priority-high"
      ? style.models.high
      : priority === "priority-medium"
        ? style.models.medium
        : style.models.normal;
  if (!slot || (!slot.effect && !slot.highlight)) {
    return null;
  }
  return slot;
}

export function resolveCardModelId(
  style: DashboardCardStyle | undefined,
  priority: DashboardPriorityType,
): string {
  return resolveCardSlot(style, priority)?.effect ?? "";
}

function priorityKey(
  priority: DashboardPriorityType,
): "high" | "medium" | "normal" {
  if (priority === "priority-high") {
    return "high";
  }
  if (priority === "priority-medium") {
    return "medium";
  }
  return "normal";
}

/** Cores de fonte do card: prioridade específica, com fallback global legado. */
export function resolveCardTextColors(
  style: DashboardCardStyle | undefined,
  priority: DashboardPriorityType,
): DashboardCardTextColors {
  const typo = style?.typography;
  if (!typo) {
    return {};
  }
  const slot = typo.priorities?.[priorityKey(priority)];
  const titleColor = slot?.titleColor || typo.titleColor;
  const situationColor = slot?.situationColor || typo.situationColor;
  const authorColor = slot?.authorColor;
  const timerColor = slot?.timerColor;
  return {
    ...(titleColor ? { titleColor } : {}),
    ...(situationColor ? { situationColor } : {}),
    ...(authorColor ? { authorColor } : {}),
    ...(timerColor ? { timerColor } : {}),
  };
}

/** Variáveis CSS de cor (`--cm-*` do efeito, `--fx-*` do realce). */
export function cardSlotStyleVars(
  slot: DashboardCardSlot | null | undefined,
): CSSProperties {
  const vars: Record<string, string> = {};
  if (slot?.colors) {
    for (const [key, value] of Object.entries(slot.colors)) {
      if (value) {
        vars[`--cm-${key}`] = value;
      }
    }
  }
  if (slot?.highlightColors) {
    for (const [key, value] of Object.entries(slot.highlightColors)) {
      if (value) {
        vars[`--fx-${key}`] = value;
      }
    }
  }
  return vars as CSSProperties;
}

export function entryColorVars(
  colors: DashboardCardColors | undefined,
): CSSProperties {
  const vars: Record<string, string> = {};
  if (!colors) {
    return vars as CSSProperties;
  }
  for (const [key, value] of Object.entries(colors)) {
    if (value) {
      vars[`--fx-${key}`] = value;
    }
  }
  return vars as CSSProperties;
}

export function boardCardStyleVars(
  style: DashboardCardStyle | undefined,
): CSSProperties {
  const typo = style?.typography;
  const vars: Record<string, string> = {};
  if (typo?.fontFamily) {
    vars["--sm-font-family"] = typo.fontFamily;
  }
  if (typo?.fontScale != null) {
    vars["--sm-font-scale"] = String(typo.fontScale);
  }
  const titleScale = typo?.titleScale ?? typo?.fontScale;
  const situationScale = typo?.situationScale ?? typo?.fontScale;
  const authorScale = typo?.authorScale ?? typo?.fontScale;
  const timerScale = typo?.timerScale ?? typo?.fontScale;
  if (titleScale != null) {
    vars["--sm-title-scale"] = String(titleScale);
  }
  if (situationScale != null) {
    vars["--sm-situation-scale"] = String(situationScale);
  }
  if (authorScale != null) {
    vars["--sm-author-scale"] = String(authorScale);
  }
  if (timerScale != null) {
    vars["--sm-timer-scale"] = String(timerScale);
  }
  if (typo?.letterSpacing != null) {
    vars["--sm-letter-spacing"] = `${typo.letterSpacing}em`;
  }
  if (typo?.titleColor) {
    vars["--sm-title-color"] = typo.titleColor;
  }
  if (typo?.situationColor) {
    vars["--sm-situation-color"] = typo.situationColor;
  }
  if (typo?.heading?.fontFamily) {
    vars["--sm-heading-font-family"] = typo.heading.fontFamily;
  }
  if (typo?.heading?.fontScale != null) {
    vars["--sm-heading-font-scale"] = String(typo.heading.fontScale);
  }
  if (typo?.heading?.letterSpacing != null) {
    vars["--sm-heading-letter-spacing"] = `${typo.heading.letterSpacing}em`;
  }
  if (typo?.heading?.color) {
    vars["--sm-heading-color"] = typo.heading.color;
  }
  if (typo?.column?.fontFamily) {
    vars["--sm-column-font-family"] = typo.column.fontFamily;
  }
  if (typo?.column?.fontScale != null) {
    vars["--sm-column-font-scale"] = String(typo.column.fontScale);
  }
  if (typo?.column?.letterSpacing != null) {
    vars["--sm-column-letter-spacing"] = `${typo.column.letterSpacing}em`;
  }
  if (typo?.column?.color) {
    vars["--sm-column-color"] = typo.column.color;
  }
  if (style?.entrySpeed && style.entrySpeed !== 1) {
    vars["--sm-entry-speed"] = String(style.entrySpeed);
  }
  return vars as CSSProperties;
}

/** Variáveis de fundo, espaçamento e head das colunas. */
export function boardThemeVars(
  theme: DashboardTheme | undefined,
): CSSProperties {
  const vars: Record<string, string> = {};
  if (theme?.pageBg) {
    vars["--sm-bg"] = theme.pageBg;
  }
  if (theme?.columnBg) {
    vars["--sm-surface"] = theme.columnBg;
  }
  if (theme?.cardGap != null) {
    vars["--sm-card-gap"] = `${theme.cardGap}px`;
  }
  if (theme?.headerBg) {
    vars["--sm-header-bg"] = theme.headerBg;
    vars["--sm-header-gradient"] = theme.headerBg2
      ? `linear-gradient(180deg, ${theme.headerBg}, ${theme.headerBg2})`
      : "none";
  }
  return vars as CSSProperties;
}

function asHeaderColor(value: unknown): string {
  const text = String(value ?? "").trim();
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(text)
    ? text
    : "";
}

/** Cor/gradiente do head desta lane. Sem cor própria, herda o tema global. */
export function laneHeaderVars(
  col: Pick<DashboardColumnConfig, "headerBg" | "headerBg2">,
  theme?: DashboardTheme,
): CSSProperties {
  const own = asHeaderColor(col.headerBg);
  const headerBg = own || asHeaderColor(theme?.headerBg);
  if (!headerBg) {
    return {};
  }
  const headerBg2 = own
    ? asHeaderColor(col.headerBg2)
    : asHeaderColor(theme?.headerBg2);
  return {
    "--lane-header-color": headerBg,
    "--lane-header-bg": headerBg2
      ? `linear-gradient(180deg, ${headerBg}, ${headerBg2})`
      : "none",
  } as CSSProperties;
}

export function laneBoardStyle(
  index: number,
  col: Pick<DashboardColumnConfig, "headerBg" | "headerBg2">,
  theme?: DashboardTheme,
): CSSProperties {
  return {
    "--lane": index % 6,
    "--column-index": index,
    ...laneHeaderVars(col, theme),
  } as CSSProperties;
}

export function boardRootStyle(
  config: Pick<DashboardConfig, "cardStyle" | "theme">,
): CSSProperties {
  return {
    ...boardCardStyleVars(config.cardStyle),
    ...boardThemeVars(config.theme),
  };
}
