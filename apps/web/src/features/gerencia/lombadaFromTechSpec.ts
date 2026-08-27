import {
  isGenericoComponente,
  lotePapelValue,
  type TechSpec,
  type TechSpecComponente,
} from "./techSpec";

export interface LombadaComponentInput {
  pgs: number | null;
  capaPapel: string | null;
  mioloPapel: string | null;
}

function pagesOf(comp: TechSpecComponente | undefined): number | null {
  if (!comp) return null;
  const n = comp.lotes.reduce((sum, lote) => sum + (Number(lote.paginas) || 0), 0);
  return n > 0 ? n : null;
}

function papelOf(comp: TechSpecComponente | undefined): string | null {
  if (!comp?.lotes.length) return null;
  const ranked = [...comp.lotes].sort(
    (a, b) => (Number(b.paginas) || 0) - (Number(a.paginas) || 0),
  );
  for (const lote of ranked) {
    const value = lotePapelValue(lote);
    if (value) return value;
  }
  return null;
}

/** Páginas e papéis da calculadora a partir dos componentes da OS. */
export function lombadaInputFromTechSpec(
  spec: TechSpec | undefined,
): LombadaComponentInput {
  if (!spec?.componentes.length) {
    return { pgs: null, capaPapel: null, mioloPapel: null };
  }
  const capa = spec.componentes.find((c) => c.tipo === "CAPA");
  const miolo = spec.componentes.find((c) => c.tipo === "MIOLO");
  const arquivo = spec.componentes.find((c) => isGenericoComponente(c));
  return {
    pgs: pagesOf(miolo) ?? pagesOf(arquivo),
    capaPapel: papelOf(capa),
    mioloPapel: papelOf(miolo) ?? papelOf(arquivo),
  };
}
