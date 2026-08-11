/** Preferências visuais locais da Inspeção (réguas, grade, guias) — por OS. */

export interface InspectorViewPrefs {
  rulers: boolean;
  grid: boolean;
  gridStepMm: number;
  guides: boolean;
  guidesXMm: number[];
  guidesYMm: number[];
}

export const DEFAULT_VIEW_PREFS: InspectorViewPrefs = {
  rulers: true,
  grid: false,
  gridStepMm: 10,
  guides: true,
  guidesXMm: [],
  guidesYMm: [],
};

function storageKey(ano: number, osId: number): string {
  return `analise-lab:view:${ano}:${osId}`;
}

function clampStep(step: number): number {
  if (!Number.isFinite(step)) return DEFAULT_VIEW_PREFS.gridStepMm;
  return Math.min(100, Math.max(1, Math.round(step)));
}

function normalizeGuideList(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  const out: number[] = [];
  for (const v of raw) {
    const n = typeof v === "number" ? v : Number(v);
    if (!Number.isFinite(n)) continue;
    out.push(Math.round(n * 10) / 10);
  }
  return out.sort((a, b) => a - b);
}

export function normalizeViewPrefs(
  partial?: Partial<InspectorViewPrefs> | null,
): InspectorViewPrefs {
  if (!partial || typeof partial !== "object") {
    return { ...DEFAULT_VIEW_PREFS, guidesXMm: [], guidesYMm: [] };
  }
  return {
    rulers: partial.rulers !== false,
    grid: Boolean(partial.grid),
    gridStepMm: clampStep(
      partial.gridStepMm ?? DEFAULT_VIEW_PREFS.gridStepMm,
    ),
    guides: partial.guides !== false,
    guidesXMm: normalizeGuideList(partial.guidesXMm),
    guidesYMm: normalizeGuideList(partial.guidesYMm),
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
  const value = Math.round(mm * 10) / 10;
  const key = axis === "x" ? "guidesXMm" : "guidesYMm";
  const list = prefs[key];
  if (list.some((g) => Math.abs(g - value) < toleranceMm)) return prefs;
  return {
    ...prefs,
    [key]: [...list, value].sort((a, b) => a - b),
  };
}

export function removeGuideMm(
  prefs: InspectorViewPrefs,
  axis: "x" | "y",
  mm: number,
  toleranceMm = 0.3,
): InspectorViewPrefs {
  const key = axis === "x" ? "guidesXMm" : "guidesYMm";
  return {
    ...prefs,
    [key]: prefs[key].filter((g) => Math.abs(g - mm) >= toleranceMm),
  };
}
