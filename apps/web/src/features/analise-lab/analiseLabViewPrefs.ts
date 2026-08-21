/** Preferências visuais locais da Inspeção (réguas, grade, guias) — por OS. */

export interface GuideLine {
  id: string;
  posMm: number;
  color: string;
}

export interface InspectorViewPrefs {
  rulers: boolean;
  grid: boolean;
  gridStepMm: number;
  gridColor: string;
  guides: boolean;
  /** Cor de pintura para novas guias (não recolore existentes). */
  guideColor: string;
  guidesX: GuideLine[];
  guidesY: GuideLine[];
  /** Offset de corte auxiliar (não persiste no banco). */
  offset: boolean;
  offsetMm: number;
  offsetColor: string;
}

export const DEFAULT_VIEW_PREFS: InspectorViewPrefs = {
  rulers: true,
  grid: false,
  gridStepMm: 10,
  gridColor: "#94a3b8",
  guides: true,
  guideColor: "#2563eb",
  guidesX: [],
  guidesY: [],
  offset: false,
  offsetMm: 7,
  offsetColor: "#dc2626",
};

/** Folhear / browse: sem auxiliares da Inspeção (réguas, grade, guias, offset). */
export const BROWSE_VIEW_PREFS: InspectorViewPrefs = {
  ...DEFAULT_VIEW_PREFS,
  rulers: false,
  grid: false,
  guides: false,
  guidesX: [],
  guidesY: [],
  offset: false,
};

const HEX_COLOR = /^#[0-9a-f]{6}$/;

let guideIdSeq = 0;

export function newGuideId(): string {
  guideIdSeq += 1;
  return `g-${Date.now().toString(36)}-${guideIdSeq}`;
}

function normalizeColor(raw: unknown, fallback: string): string {
  if (typeof raw !== "string") return fallback;
  const value = raw.trim().toLowerCase();
  return HEX_COLOR.test(value) ? value : fallback;
}

function storageKey(ano: number, osId: number): string {
  return `analise-lab:view:${ano}:${osId}`;
}

function clampStep(step: number): number {
  if (!Number.isFinite(step)) return DEFAULT_VIEW_PREFS.gridStepMm;
  return Math.min(100, Math.max(1, Math.round(step)));
}

function clampOffsetMm(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_VIEW_PREFS.offsetMm;
  return Math.min(100, Math.max(0.5, Math.round(value * 10) / 10));
}

function roundPosMm(mm: number): number {
  return Math.round(mm * 10) / 10;
}

/** Limita a posição da guia à página (0 … pageSizeMm). */
export function clampGuidePosMm(mm: number, pageSizeMm: number): number {
  if (!Number.isFinite(mm)) return 0;
  const max = Math.max(0, pageSizeMm);
  return roundPosMm(Math.min(max, Math.max(0, mm)));
}

/**
 * Aceita formato novo (GuideLine[]) ou legado (number[] / guidesXMm).
 * Atribui cor padrão às linhas migradas.
 */
export function normalizeGuideLines(
  raw: unknown,
  paintColor: string,
  legacyRaw?: unknown,
): GuideLine[] {
  const source = Array.isArray(raw)
    ? raw
    : Array.isArray(legacyRaw)
      ? legacyRaw
      : null;
  if (!source) return [];

  const out: GuideLine[] = [];
  const seenPos = new Set<number>();
  for (const entry of source) {
    if (typeof entry === "number" || typeof entry === "string") {
      const n = Number(entry);
      if (!Number.isFinite(n)) continue;
      const posMm = roundPosMm(n);
      if (seenPos.has(posMm)) continue;
      seenPos.add(posMm);
      out.push({ id: newGuideId(), posMm, color: paintColor });
      continue;
    }
    if (!entry || typeof entry !== "object") continue;
    const obj = entry as { id?: unknown; posMm?: unknown; color?: unknown };
    const pos = Number(obj.posMm);
    if (!Number.isFinite(pos)) continue;
    const posMm = roundPosMm(pos);
    if (seenPos.has(posMm)) continue;
    seenPos.add(posMm);
    const id =
      typeof obj.id === "string" && obj.id.trim()
        ? obj.id.trim()
        : newGuideId();
    out.push({
      id,
      posMm,
      color: normalizeColor(obj.color, paintColor),
    });
  }
  return out.sort((a, b) => a.posMm - b.posMm);
}

export function normalizeViewPrefs(
  partial?:
    | (Partial<InspectorViewPrefs> & {
        guidesXMm?: unknown;
        guidesYMm?: unknown;
      })
    | null,
): InspectorViewPrefs {
  if (!partial || typeof partial !== "object") {
    return { ...DEFAULT_VIEW_PREFS, guidesX: [], guidesY: [] };
  }
  const guideColor = normalizeColor(
    partial.guideColor,
    DEFAULT_VIEW_PREFS.guideColor,
  );
  return {
    rulers: partial.rulers !== false,
    grid: Boolean(partial.grid),
    gridStepMm: clampStep(
      partial.gridStepMm ?? DEFAULT_VIEW_PREFS.gridStepMm,
    ),
    gridColor: normalizeColor(partial.gridColor, DEFAULT_VIEW_PREFS.gridColor),
    guides: partial.guides !== false,
    guideColor,
    guidesX: normalizeGuideLines(
      partial.guidesX,
      guideColor,
      (partial as { guidesXMm?: unknown }).guidesXMm,
    ),
    guidesY: normalizeGuideLines(
      partial.guidesY,
      guideColor,
      (partial as { guidesYMm?: unknown }).guidesYMm,
    ),
    offset: Boolean(partial.offset),
    offsetMm: clampOffsetMm(
      partial.offsetMm ?? DEFAULT_VIEW_PREFS.offsetMm,
    ),
    offsetColor: normalizeColor(
      partial.offsetColor,
      DEFAULT_VIEW_PREFS.offsetColor,
    ),
  };
}

export function loadViewPrefs(ano: number, osId: number): InspectorViewPrefs {
  try {
    const raw = localStorage.getItem(storageKey(ano, osId));
    if (!raw) return normalizeViewPrefs();
    return normalizeViewPrefs(JSON.parse(raw) as Partial<InspectorViewPrefs>);
  } catch {
    return normalizeViewPrefs();
  }
}

export function saveViewPrefs(
  ano: number,
  osId: number,
  prefs: InspectorViewPrefs,
): void {
  try {
    localStorage.setItem(
      storageKey(ano, osId),
      JSON.stringify(normalizeViewPrefs(prefs)),
    );
  } catch {
    /* ignore quota / private mode */
  }
}

/** Linhas de grade em mm (exclui 0 e o tamanho exato da página). */
export function gridLinesMm(sizeMm: number, stepMm: number): number[] {
  const step = clampStep(stepMm);
  const size = Math.max(0, sizeMm);
  if (size <= 0) return [];
  const lines: number[] = [];
  for (let v = step; v < size - 1e-6; v += step) {
    lines.push(Math.round(v * 1000) / 1000);
  }
  return lines;
}

export function addGuideMm(
  prefs: InspectorViewPrefs,
  axis: "x" | "y",
  mm: number,
  toleranceMm = 0.3,
): InspectorViewPrefs {
  if (!Number.isFinite(mm)) return prefs;
  const value = roundPosMm(mm);
  const key = axis === "x" ? "guidesX" : "guidesY";
  const list = prefs[key];
  if (list.some((g) => Math.abs(g.posMm - value) < toleranceMm)) return prefs;
  return {
    ...prefs,
    [key]: [
      ...list,
      { id: newGuideId(), posMm: value, color: prefs.guideColor },
    ].sort((a, b) => a.posMm - b.posMm),
  };
}

export function removeGuideMm(
  prefs: InspectorViewPrefs,
  axis: "x" | "y",
  mm: number,
  toleranceMm = 0.3,
): InspectorViewPrefs {
  const key = axis === "x" ? "guidesX" : "guidesY";
  return {
    ...prefs,
    [key]: prefs[key].filter((g) => Math.abs(g.posMm - mm) >= toleranceMm),
  };
}

export function removeGuideById(
  prefs: InspectorViewPrefs,
  id: string,
): InspectorViewPrefs {
  return {
    ...prefs,
    guidesX: prefs.guidesX.filter((g) => g.id !== id),
    guidesY: prefs.guidesY.filter((g) => g.id !== id),
  };
}

export function removeGuidesByIds(
  prefs: InspectorViewPrefs,
  ids: Iterable<string>,
): InspectorViewPrefs {
  const drop = new Set(ids);
  if (drop.size === 0) return prefs;
  return {
    ...prefs,
    guidesX: prefs.guidesX.filter((g) => !drop.has(g.id)),
    guidesY: prefs.guidesY.filter((g) => !drop.has(g.id)),
  };
}

export function setGuideColorById(
  prefs: InspectorViewPrefs,
  id: string,
  color: string,
): InspectorViewPrefs {
  const nextColor = normalizeColor(color, prefs.guideColor);
  const mapList = (list: GuideLine[]) =>
    list.map((g) => (g.id === id ? { ...g, color: nextColor } : g));
  return {
    ...prefs,
    guidesX: mapList(prefs.guidesX),
    guidesY: mapList(prefs.guidesY),
  };
}

export function moveGuideMm(
  prefs: InspectorViewPrefs,
  axis: "x" | "y",
  fromMm: number,
  toMm: number,
  toleranceMm = 0.3,
): InspectorViewPrefs {
  if (!Number.isFinite(toMm)) return prefs;
  const key = axis === "x" ? "guidesX" : "guidesY";
  const list = prefs[key];
  const idx = list.findIndex((g) => Math.abs(g.posMm - fromMm) < toleranceMm);
  if (idx < 0) return prefs;
  const value = roundPosMm(toMm);
  if (
    list.some(
      (g, i) => i !== idx && Math.abs(g.posMm - value) < toleranceMm,
    )
  ) {
    return prefs;
  }
  const next = list.slice();
  next[idx] = { ...next[idx]!, posMm: value };
  return {
    ...prefs,
    [key]: next.sort((a, b) => a.posMm - b.posMm),
  };
}

export function moveGuideById(
  prefs: InspectorViewPrefs,
  id: string,
  toMm: number,
  toleranceMm = 0.3,
  pageSizeMm?: number,
): InspectorViewPrefs {
  if (!Number.isFinite(toMm)) return prefs;
  const value =
    pageSizeMm != null && Number.isFinite(pageSizeMm)
      ? clampGuidePosMm(toMm, pageSizeMm)
      : roundPosMm(toMm);
  const tryAxis = (
    key: "guidesX" | "guidesY",
  ): InspectorViewPrefs | null => {
    const list = prefs[key];
    const idx = list.findIndex((g) => g.id === id);
    if (idx < 0) return null;
    if (
      list.some(
        (g, i) => i !== idx && Math.abs(g.posMm - value) < toleranceMm,
      )
    ) {
      return prefs;
    }
    const next = list.slice();
    next[idx] = { ...next[idx]!, posMm: value };
    return {
      ...prefs,
      [key]: next.sort((a, b) => a.posMm - b.posMm),
    };
  };
  return tryAxis("guidesX") ?? tryAxis("guidesY") ?? prefs;
}

/** Distância em mm entre duas guias paralelas; null se eixos mistos / ids inválidos. */
export function parallelGuideDistanceMm(
  prefs: InspectorViewPrefs,
  idA: string,
  idB: string,
): number | null {
  const find = (
    id: string,
  ): { axis: "x" | "y"; posMm: number } | null => {
    const x = prefs.guidesX.find((g) => g.id === id);
    if (x) return { axis: "x", posMm: x.posMm };
    const y = prefs.guidesY.find((g) => g.id === id);
    if (y) return { axis: "y", posMm: y.posMm };
    return null;
  };
  const a = find(idA);
  const b = find(idB);
  if (!a || !b || a.axis !== b.axis) return null;
  return Math.round(Math.abs(a.posMm - b.posMm) * 10) / 10;
}
