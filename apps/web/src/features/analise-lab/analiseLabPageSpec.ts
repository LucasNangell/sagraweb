/** Parser de escopo de páginas: "1-15,20,23,25-30". */

export const MAX_PAGES_SPEC = 400;

export function parsePageSpec(spec: string): number[] {
  const raw = (spec || "").trim();
  if (!raw) {
    throw new Error("Informe as páginas (ex.: 1-15,20,23).");
  }
  const pages = new Set<number>();
  for (const token of raw.split(",")) {
    const part = token.trim();
    if (!part) continue;
    if (part.includes("-")) {
      const [a, b] = part.split("-", 2);
      if (!a?.trim() || !b?.trim()) {
        throw new Error(`Intervalo inválido: ${part}`);
      }
      const start = Number(a.trim());
      const end = Number(b.trim());
      if (!Number.isInteger(start) || !Number.isInteger(end)) {
        throw new Error(`Intervalo inválido: ${part}`);
      }
      if (start < 1 || end < 1) {
        throw new Error("Páginas devem ser >= 1.");
      }
      if (start > end) {
        throw new Error(`Intervalo inválido: ${part}`);
      }
      for (let n = start; n <= end; n += 1) pages.add(n);
    } else {
      const n = Number(part);
      if (!Number.isInteger(n)) {
        throw new Error(`Página inválida: ${part}`);
      }
      if (n < 1) {
        throw new Error("Páginas devem ser >= 1.");
      }
      pages.add(n);
    }
  }
  if (!pages.size) {
    throw new Error("Informe as páginas (ex.: 1-15,20,23).");
  }
  if (pages.size > MAX_PAGES_SPEC) {
    throw new Error(`Máximo de ${MAX_PAGES_SPEC} páginas por marca.`);
  }
  return [...pages].sort((a, b) => a - b);
}

export function formatPageSpec(pages: Iterable<number>): string {
  const ordered = [...new Set([...pages].map((p) => Math.trunc(p)))]
    .filter((p) => p >= 1)
    .sort((a, b) => a - b);
  if (!ordered.length) return "";
  const parts: string[] = [];
  let start = ordered[0]!;
  let prev = ordered[0]!;
  for (let i = 1; i < ordered.length; i += 1) {
    const n = ordered[i]!;
    if (n === prev + 1) {
      prev = n;
      continue;
    }
    parts.push(start === prev ? String(start) : `${start}-${prev}`);
    start = prev = n;
  }
  parts.push(start === prev ? String(start) : `${start}-${prev}`);
  return parts.join(",");
}

/** Alterna uma página no modo de seleção por clique; tolerante a spec vazio. */
export function togglePagePickSpec(spec: string, page: number): string {
  const n = Math.trunc(page);
  if (!Number.isFinite(n) || n < 1) return spec || "";
  let pages: number[] = [];
  if ((spec || "").trim()) {
    try {
      pages = parsePageSpec(spec);
    } catch {
      pages = [];
    }
  }
  const next = pages.includes(n)
    ? pages.filter((p) => p !== n)
    : [...pages, n];
  return formatPageSpec(next);
}

/** Inclui a página no spec sem remover (union). Tolerante a spec vazio. */
export function ensurePageInSpec(spec: string, page: number): string {
  const n = Math.trunc(page);
  if (!Number.isFinite(n) || n < 1) return spec || "";
  let pages: number[] = [];
  if ((spec || "").trim()) {
    try {
      pages = parsePageSpec(spec);
    } catch {
      pages = [];
    }
  }
  if (pages.includes(n)) return formatPageSpec(pages);
  return formatPageSpec([...pages, n]);
}

/**
 * Páginas do problema derivadas das marcas vinculadas.
 * Usa a página de desenho (paginaOrigem); em marcas multipágina inclui o spec.
 */
export function itemPagesSpecFromMarks(
  marks: Array<{
    itemId?: number | null;
    pagina: number;
    paginas?: string | null;
    paginaOrigem?: number | null;
  }>,
  itemId: number,
  extraPages: Iterable<number> = [],
): string {
  const pages = new Set<number>();
  for (const n of extraPages) {
    const p = Math.trunc(n);
    if (p >= 1) pages.add(p);
  }
  for (const m of marks) {
    if (m.itemId !== itemId) continue;
    const origem = Number(m.paginaOrigem || 0);
    if (origem >= 1) pages.add(origem);
    else if (m.pagina > 0) pages.add(m.pagina);
    if (m.paginas?.trim()) {
      try {
        const list = parsePageSpec(m.paginas);
        if (list.length > 1) {
          for (const n of list) pages.add(n);
        }
      } catch {
        /* ignore */
      }
    }
  }
  return formatPageSpec(pages);
}

export type ItemPageScopeFields = {
  escopo: "pagina" | "paginas";
  pagina: number;
  paginas: string;
};

/** Mesmas regras do painel: 1 página → escopo pagina; 2+ → paginas. */
export function pagesSpecToItemScope(
  pageSpec: string,
  fallbackPagina = 1,
): ItemPageScopeFields {
  let pages: number[] = [];
  try {
    pages = (pageSpec || "").trim() ? parsePageSpec(pageSpec) : [];
  } catch {
    pages = [];
  }
  if (pages.length > 1) {
    return {
      escopo: "paginas",
      pagina: 1,
      paginas: (pageSpec || "").trim() || formatPageSpec(pages),
    };
  }
  return {
    escopo: "pagina",
    pagina: pages[0] || Math.max(1, Math.trunc(fallbackPagina) || 1),
    paginas: "",
  };
}

export function validatePageSpec(spec: string): string | null {
  try {
    parsePageSpec(spec);
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : "Especificação inválida.";
  }
}

export function pageSpecIncludes(
  spec: string | null | undefined,
  page: number,
): boolean {
  if (!spec?.trim()) return false;
  try {
    return parsePageSpec(spec).includes(page);
  } catch {
    return false;
  }
}

export interface MarkPageScope {
  pagina: number;
  paginas?: string | null;
}

/** Visibilidade da marca na página atual (legado Pagina + spec Paginas). */
export function isMarkVisibleOnPage(
  mark: MarkPageScope,
  pageNumber: number,
): boolean {
  if (mark.paginas?.trim()) {
    return pageSpecIncludes(mark.paginas, pageNumber);
  }
  if (mark.pagina === 0) return true;
  return mark.pagina === pageNumber;
}

export function markScopeLabel(mark: MarkPageScope): string {
  if (mark.paginas?.trim()) {
    const s = mark.paginas.trim();
    return s.length > 28 ? `p${s.slice(0, 25)}…` : `p${s}`;
  }
  if (mark.pagina === 0) return "todas";
  return `p${mark.pagina}`;
}

export function markTouchesMultiplePages(mark: MarkPageScope): boolean {
  if (mark.paginas?.trim()) {
    try {
      return parsePageSpec(mark.paginas).length > 1;
    } catch {
      return false;
    }
  }
  return mark.pagina === 0;
}
