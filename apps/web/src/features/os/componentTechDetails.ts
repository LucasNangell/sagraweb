import type { OsComponenteRow } from "./types";

export const EMPTY_TECH_FIELD = "—";

export interface ComponentTechDetails {
  maquina: string;
  paginas: string;
  papel: string;
  cores: string;
}

interface NormalizedLote {
  paginas: number;
  maquina_link: string;
  papel_link: string;
  cores_link: string;
  papel_desc: string;
  cores_desc: string;
}

function normalizeLote(raw: unknown): NormalizedLote {
  const l = (raw ?? {}) as Record<string, unknown>;
  return {
    paginas: Number(l.paginas) || 0,
    maquina_link: String(l.maquina_link ?? "").trim(),
    papel_link: String(l.papel_link ?? "").trim(),
    cores_link: String(l.cores_link ?? "").trim(),
    papel_desc: String(l.papel_desc ?? "").trim(),
    cores_desc: String(l.cores_desc ?? "").trim(),
  };
}

function formatLoteDetail(
  pages: number,
  link: string,
  desc: string,
): string {
  const parts: string[] = [];
  if (pages > 0) {
    parts.push(`${pages} pág`);
  }
  if (link) {
    parts.push(link);
  }
  if (desc) {
    parts.push(desc);
  }
  return parts.join(" — ");
}

/** Extrai Máquina/Páginas/Papel/Cores de um componente (techspec lotes). */
export function extractComponentTechDetails(
  component: OsComponenteRow | null | undefined,
): ComponentTechDetails {
  const empty: ComponentTechDetails = {
    maquina: EMPTY_TECH_FIELD,
    paginas: EMPTY_TECH_FIELD,
    papel: EMPTY_TECH_FIELD,
    cores: EMPTY_TECH_FIELD,
  };
  if (!component) {
    return empty;
  }

  const lotes = (component.lotes ?? []).map(normalizeLote);
  if (lotes.length === 0) {
    return empty;
  }

  const maquinas = [
    ...new Set(lotes.map((l) => l.maquina_link).filter(Boolean)),
  ];
  const totalPages = lotes.reduce((sum, l) => sum + l.paginas, 0);
  const papelLines = lotes
    .map((l) => formatLoteDetail(l.paginas, l.papel_link, l.papel_desc))
    .filter(Boolean);
  const coresLines = lotes
    .map((l) => formatLoteDetail(l.paginas, l.cores_link, l.cores_desc))
    .filter(Boolean);

  return {
    maquina: maquinas.length ? maquinas.join(", ") : EMPTY_TECH_FIELD,
    paginas: totalPages > 0 ? String(totalPages) : EMPTY_TECH_FIELD,
    papel: papelLines.length ? papelLines.join("\n") : EMPTY_TECH_FIELD,
    cores: coresLines.length ? coresLines.join("\n") : EMPTY_TECH_FIELD,
  };
}

/** Localiza componente pelo id estável (inclui inativos quando listados). */
export function findComponenteById(
  componentes: OsComponenteRow[] | undefined,
  componenteId: number | null | undefined,
): OsComponenteRow | undefined {
  if (componenteId == null || !componentes?.length) {
    return undefined;
  }
  return componentes.find((c) => c.id === componenteId);
}
