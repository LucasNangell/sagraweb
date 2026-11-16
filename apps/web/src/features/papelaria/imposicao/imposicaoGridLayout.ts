import type { PapelariaImposicaoConfig } from "./types";
import {
  resolveGridOcupadas,
  type ImposicaoOcupada,
} from "./imposicaoConfigUtils";

export type ImposicaoGridFace = "frente" | "verso";

export type ImposicaoCellLayout = {
  col: number;
  row: number;
  xMm: number;
  yMmFromTop: number;
  wMm: number;
  hMm: number;
  pagina: number | null;
  rotacao: 0 | 90 | 180 | 270;
};

function pageSizeMm(config: PapelariaImposicaoConfig): {
  w: number;
  h: number;
} {
  if (
    config.pagina.origem === "fixixa" &&
    config.pagina.largura_mm &&
    config.pagina.altura_mm
  ) {
    return { w: config.pagina.largura_mm, h: config.pagina.altura_mm };
  }
  // Estimativa quando origem é borda: metade da folha ou 1/N da grade.
  const cols = Math.max(1, config.grid.colunas);
  const rows = Math.max(1, config.grid.linhas);
  const gapH = config.espacamento_mm.horizontal;
  const gapV = config.espacamento_mm.vertical;
  const w =
    (config.folha_mm.largura - Math.max(0, cols - 1) * gapH) / cols;
  const h =
    (config.folha_mm.altura - Math.max(0, rows - 1) * gapV) / rows;
  return { w: Math.max(1, w), h: Math.max(1, h) };
}

/** Layout visual (Y a partir do topo) espelhando compute_content_positions. */
export function buildImposicaoGridLayout(
  config: PapelariaImposicaoConfig,
  face: ImposicaoGridFace = "frente",
): {
  folhaW: number;
  folhaH: number;
  cells: ImposicaoCellLayout[];
} {
  const cols = Math.max(1, Math.floor(config.grid.colunas) || 1);
  const rows = Math.max(1, Math.floor(config.grid.linhas) || 1);
  const { w: pageW, h: pageH } = pageSizeMm(config);
  const gapH = config.espacamento_mm.horizontal;
  const gapV = config.espacamento_mm.vertical;
  const folhaW = config.folha_mm.largura;
  const folhaH = config.folha_mm.altura;

  const totalW = cols * pageW + Math.max(0, cols - 1) * gapH;
  const totalH = rows * pageH + Math.max(0, rows - 1) * gapV;
  let originX = 0;
  let originYTop = 0;
  if (config.centralizar_na_folha) {
    originX = Math.max(0, (folhaW - totalW) / 2);
    originYTop = Math.max(0, (folhaH - totalH) / 2);
  }

  const ocupadas = resolveGridOcupadas(config.grid, face);
  const byCell = new Map<string, { pagina: number; rotacao: 0 | 90 | 180 | 270 }>();
  for (const o of ocupadas) {
    byCell.set(`${o.col},${o.row}`, {
      pagina: o.pagina,
      rotacao: o.rotacao ?? 0,
    });
  }

  const cells: ImposicaoCellLayout[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const xMm = originX + col * (pageW + gapH);
      const yMmFromTop = originYTop + row * (pageH + gapV);
      const occ = byCell.get(`${col},${row}`);
      cells.push({
        col,
        row,
        xMm,
        yMmFromTop,
        wMm: pageW,
        hMm: pageH,
        pagina: occ?.pagina ?? null,
        rotacao: occ?.rotacao ?? 0,
      });
    }
  }

  return { folhaW, folhaH, cells };
}

export function nextPaginaNumber(ocupadas: ImposicaoOcupada[]): number {
  if (ocupadas.length < 1) return 1;
  return Math.max(...ocupadas.map((o) => o.pagina)) + 1;
}

/**
 * Clique na célula:
 * - se já tem `pagina`, limpa;
 * - senão, atribui `pagina` (permite repetir o mesmo número).
 * Sem `pagina` explícita: comportamento legado (próximo número único / remoção com renumeração).
 */
export function paintCellOcupada(
  ocupadas: ImposicaoOcupada[] | undefined,
  cols: number,
  rows: number,
  col: number,
  row: number,
  pagina: number,
): ImposicaoOcupada[] {
  const page = Math.max(1, Math.floor(pagina) || 1);
  const current =
    ocupadas ??
    resolveGridOcupadas({ colunas: cols, linhas: rows });
  const idx = current.findIndex((o) => o.col === col && o.row === row);
  if (idx >= 0 && current[idx].pagina === page) {
    return current.filter((_, i) => i !== idx);
  }
  const without = current.filter((o) => !(o.col === col && o.row === row));
  const prev = idx >= 0 ? current[idx] : undefined;
  const nextCell: ImposicaoOcupada = {
    col,
    row,
    pagina: page,
    ...(prev?.rotacao ? { rotacao: prev.rotacao } : {}),
  };
  return [...without, nextCell].sort(
    (a, b) => a.pagina - b.pagina || a.row - b.row || a.col - b.col,
  );
}

/** Cicla rotação da célula: 0 → 90 → 180 → 270 → 0. */
export function rotateCellOcupada(
  ocupadas: ImposicaoOcupada[] | undefined,
  cols: number,
  rows: number,
  col: number,
  row: number,
): ImposicaoOcupada[] {
  const current =
    ocupadas ??
    resolveGridOcupadas({ colunas: cols, linhas: rows });
  const idx = current.findIndex((o) => o.col === col && o.row === row);
  if (idx < 0) return current;
  const prev = current[idx];
  const nextRot = (((prev.rotacao ?? 0) + 90) % 360) as 0 | 90 | 180 | 270;
  const next = current.map((o, i) =>
    i === idx
      ? nextRot === 0
        ? { col: o.col, row: o.row, pagina: o.pagina }
        : { col: o.col, row: o.row, pagina: o.pagina, rotacao: nextRot }
      : o,
  );
  return next;
}

/** Legado: toggle com numeração sequencial exclusiva (testes / compat). */
export function toggleCellOcupada(
  ocupadas: ImposicaoOcupada[] | undefined,
  cols: number,
  rows: number,
  col: number,
  row: number,
): ImposicaoOcupada[] {
  const current =
    ocupadas ??
    resolveGridOcupadas({ colunas: cols, linhas: rows });
  const idx = current.findIndex((o) => o.col === col && o.row === row);
  if (idx >= 0) {
    const next = current
      .filter((_, i) => i !== idx)
      .sort((a, b) => a.pagina - b.pagina || a.row - b.row || a.col - b.col)
      .map((o, i) => ({ ...o, pagina: i + 1 }));
    return next;
  }
  return [
    ...current,
    { col, row, pagina: nextPaginaNumber(current) },
  ].sort((a, b) => a.pagina - b.pagina || a.row - b.row || a.col - b.col);
}
