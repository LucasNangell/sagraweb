/**
 * Progressão de desdobramento: 0 = fechado, 1 = aberto.
 * Níveis (ordens distintas, maior ordem abre primeiro no unfold).
 */
export function unfoldLevelProgress(
  unfold01: number,
  levelCount: number,
  levelIndex: number,
): number {
  const p = Math.min(1, Math.max(0, unfold01));
  const n = Math.max(1, levelCount);
  return Math.min(1, Math.max(0, p * n - levelIndex));
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

/**
 * Atraso do nível i relativo ao open01 do nível anterior (i−1).
 * Nível 0 (abre primeiro) ignora; omitido/ inválido → 1 (comportamento legado).
 */
function waitForLevel(
  opsAtLevel: Array<{ startAfterPrevOpen01?: number }>,
): number {
  let max = 0;
  let any = false;
  for (const op of opsAtLevel) {
    const raw = op.startAfterPrevOpen01;
    if (raw == null || !Number.isFinite(raw)) continue;
    any = true;
    max = Math.max(max, clamp01(raw));
  }
  return any ? max : 1;
}

export type ProgressOperation = {
  id: string;
  order: number;
  phaseId?: string;
  /** Fração open01 do nível anterior antes deste nível começar (0–1; default 1). */
  startAfterPrevOpen01?: number;
};

/**
 * Mapa operationId → open01 (0 fechado / 1 aberto).
 * Operações do mesmo order abrem juntas.
 *
 * Com todos os waits = 1: open_i = clamp(unfold01 * n - i) (legado).
 * Com wait w: o nível i começa quando o anterior atinge open01 = w.
 */
export function resolveOperationProgress(
  operations: ProgressOperation[],
  unfold01: number,
): Map<string, number> {
  const levels = [...new Set(operations.map((o) => o.order))].sort(
    (a, b) => b - a,
  );
  const n = Math.max(1, levels.length);
  const p = clamp01(unfold01);

  const starts: number[] = [0];
  for (let i = 1; i < n; i++) {
    const order = levels[i]!;
    const opsAtLevel = operations.filter((o) => o.order === order);
    const w = waitForLevel(opsAtLevel);
    starts.push(starts[i - 1]! + w);
  }
  const total = starts[n - 1]! + 1;

  const out = new Map<string, number>();
  levels.forEach((order, i) => {
    const local = clamp01(p * total - starts[i]!);
    for (const op of operations.filter((o) => o.order === order)) {
      out.set(op.id, local);
    }
  });
  return out;
}

export function closedAngleRad(
  targetDeg: number,
  sign: number,
  open01: number,
): number {
  return sign * ((targetDeg * Math.PI) / 180) * (1 - open01);
}
