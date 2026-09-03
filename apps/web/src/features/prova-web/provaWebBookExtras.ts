import type {
  FoldAxis,
  FoldCrease,
  FoldModelConfig,
  FoldModelCreaseFrac,
  FoldMovingSide,
  FoldOperation,
  FoldTowards,
  ProvaWebBookExtraInsert,
  ProvaWebBookExtraKind,
  ProvaWebBookExtraSource,
  ProvaWebBookExtras,
} from "@/api/provaWeb";

export const BOOK_EXTRA_KIND_LABELS: Record<ProvaWebBookExtraKind, string> = {
  insert: "Encarte simples",
  "large-sheet": "Página maior",
  foldout: "Encarte dobrado",
  gatefold: "Dobra portão",
  zfold: "Dobra sanfonada",
  "custom-fold": "Dobra personalizada",
};

export const BOOK_EXTRA_SOURCE_LABELS: Record<ProvaWebBookExtraSource, string> = {
  unico: "Arquivo único",
  miolo: "Miolo",
  capa: "Capa",
};

export const BOOK_EXTRA_FOLD_KINDS = new Set<ProvaWebBookExtraKind>([
  "foldout",
  "gatefold",
  "zfold",
  "custom-fold",
]);

const VALID_KINDS = new Set<ProvaWebBookExtraKind>([
  "insert",
  "large-sheet",
  "foldout",
  "gatefold",
  "zfold",
  "custom-fold",
]);

const VALID_SOURCES = new Set<ProvaWebBookExtraSource>([
  "unico",
  "miolo",
  "capa",
]);

const VALID_AXES = new Set<FoldAxis>(["vertical", "horizontal"]);
const VALID_MOVING = new Set<FoldMovingSide>(["negative", "positive"]);
const VALID_TOWARDS = new Set<FoldTowards>(["front", "back"]);

export function emptyBookExtras(): ProvaWebBookExtras {
  return { version: 1, inserts: [] };
}

export function normalizeBookExtras(raw: unknown): ProvaWebBookExtras {
  if (!raw || typeof raw !== "object") return emptyBookExtras();
  const data = raw as Partial<ProvaWebBookExtras>;
  const inserts = Array.isArray(data.inserts)
    ? data.inserts.flatMap((item, index) => normalizeInsert(item, index))
    : [];
  return { version: 1, inserts };
}

function normalizeInsert(raw: unknown, index: number): ProvaWebBookExtraInsert[] {
  if (!raw || typeof raw !== "object") return [];
  const data = raw as Partial<ProvaWebBookExtraInsert>;
  const source = VALID_SOURCES.has(data.sourceComponent as ProvaWebBookExtraSource)
    ? (data.sourceComponent as ProvaWebBookExtraSource)
    : "miolo";
  const kind = VALID_KINDS.has(data.kind as ProvaWebBookExtraKind)
    ? (data.kind as ProvaWebBookExtraKind)
    : "insert";
  const start = clampPage(data.sourcePageStart, 1);
  const end = Math.max(start, clampPage(data.sourcePageEnd, start));
  const widthMm = clampMm(data.widthMm, 10, 2000, 210);
  const heightMm = clampMm(data.heightMm, 10, 2000, 297);
  const id = String(data.id || `encarte-${index + 1}`)
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "-")
    .slice(0, 48);
  const label =
    String(data.label || BOOK_EXTRA_KIND_LABELS[kind]).trim().slice(0, 80) ||
    BOOK_EXTRA_KIND_LABELS[kind];
  const isFold = BOOK_EXTRA_FOLD_KINDS.has(kind);
  let hasVerso = Boolean(data.hasVerso) && isFold;
  if (hasVerso && end === start) hasVerso = false;
  const foldConfig =
    kind === "custom-fold" ? normalizeFoldConfig(data.foldConfig) : null;
  return [
    {
      id: id || `encarte-${index + 1}`,
      label,
      sourceComponent: source,
      sourcePageStart: start,
      sourcePageEnd: end,
      kind,
      widthMm,
      heightMm,
      closedWidthMm:
        data.closedWidthMm == null
          ? null
          : clampMm(data.closedWidthMm, 10, 2000, widthMm),
      closedHeightMm:
        data.closedHeightMm == null
          ? null
          : clampMm(data.closedHeightMm, 10, 2000, heightMm),
      foldLines: Array.isArray(data.foldLines)
        ? data.foldLines
            .filter((line) => line.axis === "vertical" || line.axis === "horizontal")
            .map((line) => ({
              axis: line.axis,
              positionMm: clampMm(line.positionMm, 0, 2000, 0),
            }))
        : [],
      hasVerso,
      foldConfig,
      notes: data.notes ? String(data.notes).trim().slice(0, 240) : null,
    },
  ];
}

export function normalizeFoldConfig(raw: unknown): FoldModelConfig | null {
  if (!raw || typeof raw !== "object") return null;
  const data = raw as Partial<FoldModelConfig>;
  const creases = Array.isArray(data.creases)
    ? data.creases.flatMap((c, i) => normalizeModelCrease(c, i))
    : [];
  if (!creases.length) return null;
  const creaseIds = new Set(creases.map((c) => c.id));
  const operations = Array.isArray(data.operations)
    ? data.operations.flatMap((o, i) => normalizeModelOperation(o, i, creaseIds))
    : [];
  if (!operations.length) return null;
  return {
    version: 1,
    creases,
    operations,
    basePanelId:
      data.basePanelId == null || data.basePanelId === ""
        ? null
        : String(data.basePanelId).slice(0, 32),
    ...(data.physical ? { physical: { ...data.physical } } : {}),
    ...(data.backArtworkTransform
      ? { backArtworkTransform: { ...data.backArtworkTransform } }
      : {}),
  };
}

function normalizeModelCrease(
  raw: unknown,
  index: number,
): FoldModelCreaseFrac[] {
  if (!raw || typeof raw !== "object") return [];
  const data = raw as Partial<FoldModelCreaseFrac>;
  const axis = VALID_AXES.has(data.axis as FoldAxis)
    ? (data.axis as FoldAxis)
    : null;
  if (!axis) return [];
  const frac = Number(data.positionFrac);
  if (!Number.isFinite(frac) || frac <= 0.02 || frac >= 0.98) return [];
  const id = String(data.id || `c${index + 1}`)
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "-")
    .slice(0, 32);
  return [
    {
      id: id || `c${index + 1}`,
      axis,
      positionFrac: Math.round(frac * 1e6) / 1e6,
    },
  ];
}

function normalizeModelOperation(
  raw: unknown,
  index: number,
  creaseIds: Set<string>,
): FoldOperation[] {
  if (!raw || typeof raw !== "object") return [];
  const data = raw as Partial<FoldOperation>;
  const creaseId = String(data.creaseId || "").trim();
  if (!creaseIds.has(creaseId)) return [];
  const movingSide = VALID_MOVING.has(data.movingSide as FoldMovingSide)
    ? (data.movingSide as FoldMovingSide)
    : "positive";
  const towards = VALID_TOWARDS.has(data.towards as FoldTowards)
    ? (data.towards as FoldTowards)
    : "front";
  const order = Math.max(1, Math.min(32, Math.floor(Number(data.order) || index + 1)));
  const targetAngleDeg = Math.max(
    1,
    Math.min(180, Math.floor(Number(data.targetAngleDeg) || 180)),
  );
  const id = String(data.id || `o${index + 1}`)
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "-")
    .slice(0, 32);
  const op: FoldOperation = {
    id: id || `o${index + 1}`,
    creaseId,
    order,
    movingSide,
    towards,
    targetAngleDeg,
  };
  if (data.phaseId) op.phaseId = String(data.phaseId).slice(0, 32);
  const stagger = Number(data.startAfterPrevOpen01);
  if (Number.isFinite(stagger) && Math.abs(stagger - 1) > 1e-6) {
    op.startAfterPrevOpen01 = Math.min(1, Math.max(0, stagger));
  }
  return [op];
}

export function foldLinesFromCreases(
  creases: FoldCrease[],
): ProvaWebBookExtraInsert["foldLines"] {
  return creases.map((c) => ({
    axis: c.axis,
    positionMm: Math.round(c.positionMm * 10) / 10,
  }));
}

function clampPage(value: unknown, fallback: number): number {
  const n = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(9999, n));
}

function clampMm(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n * 10) / 10));
}

export function nextBookExtraId(inserts: ProvaWebBookExtraInsert[]): string {
  let i = inserts.length + 1;
  const used = new Set(inserts.map((item) => item.id));
  while (used.has(`encarte-${i}`)) i += 1;
  return `encarte-${i}`;
}
