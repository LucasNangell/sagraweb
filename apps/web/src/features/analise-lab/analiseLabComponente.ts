import type { ProvaWebPageMeta } from "@/api/provaWeb";

import { normalizeComponenteOrigem } from "@/features/analise/analiseItemsTree";

import { parsePageSpec } from "./analiseLabPageSpec";

export type LabComponente = "Capa" | "Miolo" | "Arq. Único";

export function roleToComponente(
  role: string,
  modo: string,
): LabComponente {
  if ((modo || "").toLowerCase() === "unico") return "Arq. Único";
  const r = (role || "").trim().toLowerCase();
  if (r.startsWith("cover")) return "Capa";
  return "Miolo";
}

export function componenteForPages(
  modo: string,
  pages: ProvaWebPageMeta[],
  pageNumbers: number[],
): Record<LabComponente, number[]> {
  const byNum = new Map(pages.map((p) => [p.page, p]));
  const grouped: Partial<Record<LabComponente, number[]>> = {};
  for (const n of [...new Set(pageNumbers)].filter((x) => x >= 1).sort((a, b) => a - b)) {
    const meta = byNum.get(n);
    const comp = roleToComponente(meta?.role || "page", modo);
    (grouped[comp] ||= []).push(n);
  }
  return grouped as Record<LabComponente, number[]>;
}

export function splitScopeByComponente(
  modo: string,
  pages: ProvaWebPageMeta[],
  pageNumbers: number[],
): Array<{ componente: LabComponente; pages: number[] }> {
  const grouped = componenteForPages(modo, pages, pageNumbers);
  return (Object.entries(grouped) as [LabComponente, number[]][]).map(
    ([componente, pagesList]) => ({ componente, pages: pagesList }),
  );
}

/** Expande ocorrências de um item Lab no manifesto. */
export function itemOccurrences(
  item: {
    escopo: string;
    pagina: number;
    paginas?: string | null;
    componente?: string;
  },
  pages: ProvaWebPageMeta[],
  parseSpec: (spec: string) => number[],
): number[] {
  const all = pages.map((p) => p.page).filter((n) => n >= 1);
  const escopo = (item.escopo || "pagina").toLowerCase();
  if (escopo === "arquivo" || (!item.paginas && item.pagina === 0)) {
    const comp = item.componente || "";
    if (comp === "Arq. Único" || !comp) return all;
    return pages
      .filter(
        (p) =>
          roleToComponente(p.role || "page", "capa_miolo") === comp,
      )
      .map((p) => p.page);
  }
  if (item.paginas?.trim()) {
    try {
      const set = new Set(all);
      return parseSpec(item.paginas).filter((n) => set.has(n) || !all.length);
    } catch {
      return [];
    }
  }
  return item.pagina >= 1 ? [item.pagina] : [];
}

/**
 * Componentes em que o item deve aparecer na lista (display).
 * Usa páginas do escopo + manifesto; cai no componente armazenado se não houver páginas.
 */
export function itemHomesForComponents(
  item: {
    escopo: string;
    pagina: number;
    paginas?: string | null;
    componente?: string;
  },
  pages: ProvaWebPageMeta[],
  modo = "capa_miolo",
): string[] {
  const stored = normalizeComponenteOrigem(item.componente);
  if (!pages.length) return [stored];

  const occ = itemOccurrences(item, pages, parsePageSpec);
  if (!occ.length) return [stored];

  const byComp = componenteForPages(modo, pages, occ);
  const homes = (Object.entries(byComp) as [LabComponente, number[]][])
    .filter(([, list]) => list.length > 0)
    .map(([comp]) => comp);

  return homes.length ? homes : [stored];
}
