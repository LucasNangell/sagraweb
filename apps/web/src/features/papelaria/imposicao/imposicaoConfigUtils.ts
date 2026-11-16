import {
  DEFAULT_IMPOSICAO_CONFIG,
  type PapelariaImposicaoConfig,
  type PapelariaImposicaoWorkStyle,
} from "./types";

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function requirePositive(
  obj: Record<string, unknown>,
  key: string,
  allowZero = false,
  label = key,
): number {
  const value = obj[key];
  if (!isNumber(value)) {
    throw new Error(`${label} deve ser numérico.`);
  }
  if (allowZero) {
    if (value < 0) throw new Error(`${label} deve ser >= 0.`);
  } else if (value <= 0) {
    throw new Error(`${label} deve ser > 0.`);
  }
  return value;
}

function requirePositiveInt(
  obj: Record<string, unknown>,
  key: string,
  label = key,
): number {
  const value = obj[key];
  if (!isNumber(value) || !Number.isInteger(value) || value < 1) {
    throw new Error(`${label} deve ser inteiro >= 1.`);
  }
  return value;
}

function requireBool(obj: Record<string, unknown>, key: string): boolean {
  const value = obj[key];
  if (typeof value !== "boolean") {
    throw new Error(`${key} deve ser booleano.`);
  }
  return value;
}

export type ImposicaoOcupada = {
  col: number;
  row: number;
  pagina: number;
};

function normalizeOcupadas(
  raw: unknown,
  cols: number,
  rows: number,
  fieldLabel = "grid.ocupadas",
): ImposicaoOcupada[] {
  if (!Array.isArray(raw)) {
    throw new Error(`${fieldLabel} deve ser uma lista.`);
  }
  if (raw.length < 1) {
    throw new Error(`${fieldLabel} deve ter ao menos uma célula.`);
  }
  const seenCells = new Set<string>();
  const out: ImposicaoOcupada[] = [];
  raw.forEach((item, idx) => {
    const label = `${fieldLabel}[${idx}]`;
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`${label} deve ser um objeto.`);
    }
    const rec = item as Record<string, unknown>;
    for (const key of ["col", "row", "pagina"] as const) {
      if (!isNumber(rec[key]) || !Number.isInteger(rec[key])) {
        throw new Error(`${label}.${key} deve ser inteiro.`);
      }
    }
    const col = rec.col as number;
    const row = rec.row as number;
    const pagina = rec.pagina as number;
    if (col < 0 || col >= cols) {
      throw new Error(`${label}.col fora da grade (0..${cols - 1}).`);
    }
    if (row < 0 || row >= rows) {
      throw new Error(`${label}.row fora da grade (0..${rows - 1}).`);
    }
    if (pagina < 1) {
      throw new Error(`${label}.pagina deve ser >= 1.`);
    }
    const cellKey = `${col},${row}`;
    if (seenCells.has(cellKey)) {
      throw new Error(`${label}: célula (${col},${row}) duplicada.`);
    }
    seenCells.add(cellKey);
    out.push({ col, row, pagina });
  });
  out.sort(
    (a, b) => a.pagina - b.pagina || a.row - b.row || a.col - b.col,
  );
  return out;
}

function fillSequentialOcupadas(cols: number, rows: number): ImposicaoOcupada[] {
  const out: ImposicaoOcupada[] = [];
  let n = 1;
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      out.push({ col, row, pagina: n });
      n += 1;
    }
  }
  return out;
}

/** Grade cheia com a mesma página (step & repeat padrão). */
function fillSamePaginaOcupadas(
  cols: number,
  rows: number,
  pagina = 1,
): ImposicaoOcupada[] {
  const page = Math.max(1, Math.floor(pagina) || 1);
  const out: ImposicaoOcupada[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      out.push({ col, row, pagina: page });
    }
  }
  return out;
}

/** Grade cheia (legado) ou ocupadas explícitas, ordenadas por pagina. */
export function resolveGridOcupadas(
  grid: PapelariaImposicaoConfig["grid"],
  face: "frente" | "verso" = "frente",
): ImposicaoOcupada[] {
  const cols = Math.max(1, Math.floor(grid.colunas) || 1);
  const rows = Math.max(1, Math.floor(grid.linhas) || 1);
  const raw = face === "verso" ? grid.ocupadas_verso : grid.ocupadas;
  if (raw == null) {
    // Omitido = step & repeat da página 1 (não sequência 1..N).
    return fillSamePaginaOcupadas(cols, rows, 1);
  }
  const label =
    face === "verso" ? "grid.ocupadas_verso" : "grid.ocupadas";
  return normalizeOcupadas(raw, cols, rows, label);
}

/** Remove células fora da grade; preserva números de página (repetições). */
export function clampOcupadasToGrid(
  ocupadas: ImposicaoOcupada[] | undefined,
  cols: number,
  rows: number,
): ImposicaoOcupada[] | undefined {
  if (ocupadas == null) return undefined;
  const kept = ocupadas
    .filter((o) => o.col >= 0 && o.col < cols && o.row >= 0 && o.row < rows)
    .sort((a, b) => a.pagina - b.pagina || a.row - b.row || a.col - b.col);
  if (kept.length < 1) return undefined;
  return kept;
}

/** Preenche a grade em sequência 1..N (páginas distintas do PDF). */
export function fillGridOcupadas(
  cols: number,
  rows: number,
): ImposicaoOcupada[] {
  return fillSequentialOcupadas(cols, rows);
}

/** Preenche toda a grade com o mesmo número de página (repetição). */
export function fillGridWithPagina(
  cols: number,
  rows: number,
  pagina: number,
): ImposicaoOcupada[] {
  return fillSamePaginaOcupadas(cols, rows, pagina);
}

/** Aceita schema novo e legado (folha/largura_mm, repeticoes, etc.). */
function coerceRaw(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...data };

  if (!out.folha_mm && out.folha && typeof out.folha === "object") {
    const f = out.folha as Record<string, unknown>;
    out.folha_mm = {
      largura: f.largura_mm ?? f.largura,
      altura: f.altura_mm ?? f.altura,
    };
  }

  if (!out.espacamento_mm) {
    out.espacamento_mm = { horizontal: 0, vertical: 0 };
  }

  if (out.sangria_mm == null) out.sangria_mm = 0;
  if (out.marcas_corte == null) out.marcas_corte = false;
  if (out.marcas_pdf_path === undefined) out.marcas_pdf_path = null;
  if (out.imposicao_pdf_path === undefined) out.imposicao_pdf_path = null;
  if (out.centralizar_na_folha == null) out.centralizar_na_folha = true;
  if (out.work_style == null) out.work_style = "Simplex";
  if (out.usar_pre_impresso == null) out.usar_pre_impresso = false;
  if (out.jdf_import_root === undefined) out.jdf_import_root = null;

  return out;
}

const VALID_WORK_STYLES: PapelariaImposicaoWorkStyle[] = ["Simplex", "Duplex"];

export function validateImposicaoConfigObject(
  data: unknown,
  options?: { requireMarcasPdf?: boolean },
): PapelariaImposicaoConfig {
  const requireMarcasPdf = options?.requireMarcasPdf ?? true;
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Configuração de imposição deve ser um objeto JSON.");
  }
  const raw = coerceRaw(data as Record<string, unknown>);

  const folhaRaw = raw.folha_mm;
  if (!folhaRaw || typeof folhaRaw !== "object" || Array.isArray(folhaRaw)) {
    throw new Error("Campo obrigatório ausente: folha_mm.");
  }
  const folha = folhaRaw as Record<string, unknown>;

  const paginaRaw = raw.pagina;
  if (!paginaRaw || typeof paginaRaw !== "object" || Array.isArray(paginaRaw)) {
    throw new Error("Campo obrigatório ausente: pagina.");
  }
  const pagina = paginaRaw as Record<string, unknown>;
  const origem = pagina.origem;
  if (origem !== "borda" && origem !== "fixixa") {
    throw new Error("pagina.origem inválido. Valores: borda, fixixa.");
  }

  const gridRaw = raw.grid;
  if (!gridRaw || typeof gridRaw !== "object" || Array.isArray(gridRaw)) {
    throw new Error("Campo obrigatório ausente: grid.");
  }
  const grid = gridRaw as Record<string, unknown>;

  const espRaw = raw.espacamento_mm;
  if (!espRaw || typeof espRaw !== "object" || Array.isArray(espRaw)) {
    throw new Error("Campo obrigatório ausente: espacamento_mm.");
  }
  const esp = espRaw as Record<string, unknown>;

  const sangria = raw.sangria_mm;
  if (!isNumber(sangria) || sangria < 0) {
    throw new Error("sangria_mm deve ser numérico >= 0.");
  }

  const workStyle = raw.work_style;
  if (
    typeof workStyle !== "string" ||
    !VALID_WORK_STYLES.includes(workStyle as PapelariaImposicaoWorkStyle)
  ) {
    throw new Error(
      `work_style inválido. Valores: ${VALID_WORK_STYLES.join(", ")}.`,
    );
  }
  const work_style = workStyle as PapelariaImposicaoWorkStyle;

  const paginaOut: PapelariaImposicaoConfig["pagina"] = { origem };
  if (origem === "fixixa") {
    paginaOut.largura_mm = requirePositive(pagina, "largura_mm", false, "pagina.largura_mm");
    paginaOut.altura_mm = requirePositive(pagina, "altura_mm", false, "pagina.altura_mm");
  }

  const cols = requirePositiveInt(grid, "colunas", "grid.colunas");
  const rows = requirePositiveInt(grid, "linhas", "grid.linhas");
  const gridOut: PapelariaImposicaoConfig["grid"] = {
    colunas: cols,
    linhas: rows,
  };
  if (grid.ocupadas !== undefined && grid.ocupadas !== null) {
    gridOut.ocupadas = normalizeOcupadas(grid.ocupadas, cols, rows, "grid.ocupadas");
  }
  if (work_style === "Duplex") {
    if (grid.ocupadas_verso !== undefined && grid.ocupadas_verso !== null) {
      gridOut.ocupadas_verso = normalizeOcupadas(
        grid.ocupadas_verso,
        cols,
        rows,
        "grid.ocupadas_verso",
      );
    }
  }

  return {
    folha_mm: {
      largura: requirePositive(folha, "largura", false, "folha_mm.largura"),
      altura: requirePositive(folha, "altura", false, "folha_mm.altura"),
    },
    pagina: paginaOut,
    grid: gridOut,
    espacamento_mm: {
      horizontal: requirePositive(esp, "horizontal", true, "espacamento_mm.horizontal"),
      vertical: requirePositive(esp, "vertical", true, "espacamento_mm.vertical"),
    },
    sangria_mm: sangria,
    marcas_corte: requireBool(raw, "marcas_corte"),
    marcas_pdf_path: (() => {
      const marcas = requireBool(raw, "marcas_corte");
      const pathRaw = raw.marcas_pdf_path;
      if (pathRaw == null || pathRaw === "") {
        if (marcas && requireMarcasPdf) {
          throw new Error(
            "Com marcas de corte ativas, informe o caminho do PDF de marcas.",
          );
        }
        return null;
      }
      if (typeof pathRaw !== "string") {
        throw new Error("marcas_pdf_path deve ser texto.");
      }
      const path = pathRaw.trim();
      if (!path.toLowerCase().endsWith(".pdf")) {
        throw new Error("marcas_pdf_path deve apontar para um arquivo .pdf.");
      }
      return marcas ? path : null;
    })(),
    centralizar_na_folha: requireBool(raw, "centralizar_na_folha"),
    work_style,
    usar_pre_impresso:
      raw.usar_pre_impresso == null
        ? false
        : requireBool(raw, "usar_pre_impresso"),
    jdf_import_root: (() => {
      const pathRaw = raw.jdf_import_root;
      if (pathRaw == null || pathRaw === "") return null;
      if (typeof pathRaw !== "string") {
        throw new Error("jdf_import_root deve ser texto.");
      }
      const path = pathRaw.trim();
      return path || null;
    })(),
    imposicao_pdf_path: (() => {
      const pathRaw = raw.imposicao_pdf_path;
      if (pathRaw == null || pathRaw === "") return null;
      if (typeof pathRaw !== "string") {
        throw new Error("imposicao_pdf_path deve ser texto.");
      }
      const path = pathRaw.trim();
      if (path && !path.toLowerCase().endsWith(".pdf")) {
        throw new Error("imposicao_pdf_path deve apontar para um arquivo .pdf.");
      }
      return path || null;
    })(),
  };
}

export function parseImposicaoConfigJson(
  raw: string | null | undefined,
): PapelariaImposicaoConfig | null {
  if (!raw?.trim()) return null;
  const parsed = JSON.parse(raw) as unknown;
  return validateImposicaoConfigObject(parsed);
}

export function formatImposicaoConfigJson(config: PapelariaImposicaoConfig): string {
  return JSON.stringify(config, null, 2);
}

export function cloneDefaultImposicaoConfig(): PapelariaImposicaoConfig {
  return structuredClone(DEFAULT_IMPOSICAO_CONFIG);
}

/** Default com pré-impresso/hotfolder para Timbrado A4 e Pasta Avulso. */
export function cloneImposicaoConfigForProduto(
  produto?: string | null,
): PapelariaImposicaoConfig {
  const cfg = cloneDefaultImposicaoConfig();
  const name = (produto || "").trim().toLowerCase();
  if (name.startsWith("pasta avulso")) {
    cfg.usar_pre_impresso = true;
    cfg.jdf_import_root =
      "\\\\apogee\\JDFImportRoot\\Papelaria_Pasta";
  } else if (name === "timbrado a4") {
    cfg.usar_pre_impresso = true;
    cfg.jdf_import_root =
      "\\\\apogee\\JDFImportRoot\\Papelaria_Timbrado";
  }
  return cfg;
}

export function configFromModeloOrDefault(
  raw: string | null | undefined,
): PapelariaImposicaoConfig {
  try {
    return parseImposicaoConfigJson(raw) ?? cloneDefaultImposicaoConfig();
  } catch {
    return cloneDefaultImposicaoConfig();
  }
}

export type PapelariaImposicaoVariante = "digital" | "offset";

export type PapelariaImposicaoVariants = {
  digital: PapelariaImposicaoConfig | null;
  offset: PapelariaImposicaoConfig | null;
};

function isVariantsEnvelope(data: Record<string, unknown>): boolean {
  return "digital" in data || "offset" in data;
}

/** Lê override do modelo (legado único ou {digital, offset}). */
export function parseImposicaoVariantsJson(
  raw: string | null | undefined,
): PapelariaImposicaoVariants {
  const empty: PapelariaImposicaoVariants = { digital: null, offset: null };
  if (!raw?.trim()) return empty;
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Configuração de imposição inválida.");
  }
  const obj = parsed as Record<string, unknown>;
  if (isVariantsEnvelope(obj)) {
    return {
      digital:
        obj.digital == null
          ? null
          : validateImposicaoConfigObject(obj.digital),
      offset:
        obj.offset == null ? null : validateImposicaoConfigObject(obj.offset),
    };
  }
  const single = validateImposicaoConfigObject(obj);
  return { digital: single, offset: single };
}

export function formatImposicaoVariantsJson(
  variants: PapelariaImposicaoVariants,
): string | null {
  if (!variants.digital && !variants.offset) return null;
  return JSON.stringify(
    {
      digital: variants.digital,
      offset: variants.offset,
    },
    null,
    2,
  );
}

export function variantsFromModeloOrEmpty(
  raw: string | null | undefined,
): PapelariaImposicaoVariants {
  try {
    return parseImposicaoVariantsJson(raw);
  } catch {
    return { digital: null, offset: null };
  }
}
