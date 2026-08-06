import { formatProcessoMask } from "./processoMask";
import type {
  OsSearchFilters,
  SavedFilter,
  SavedFilterCriterios,
  UserFiltersDefault,
} from "./types";
import { emptySavedFilterCriterios } from "./types";

export function normalizeSavedFilterCriterios(
  raw?: SavedFilterCriterios | null,
): SavedFilterCriterios {
  const empty = emptySavedFilterCriterios();
  if (!raw) {
    return empty;
  }
  return {
    nr_os: raw.nr_os ?? null,
    anos: Array.isArray(raw.anos) ? raw.anos.filter((n) => Number.isFinite(n)) : [],
    processo: typeof raw.processo === "string" ? raw.processo : "",
    categorias: Array.isArray(raw.categorias) ? raw.categorias : [],
    solicitantes: Array.isArray(raw.solicitantes) ? raw.solicitantes : [],
    titulo: typeof raw.titulo === "string" ? raw.titulo : "",
    produtos: Array.isArray(raw.produtos) ? raw.produtos : [],
    maquinas: Array.isArray(raw.maquinas) ? raw.maquinas : [],
    prioridade: Array.isArray(raw.prioridade) ? raw.prioridade : [],
  };
}

/** Patch de store ao aplicar filtro salvo (ou default preferências). */
export function savedFilterToOsPatch(
  filter: Pick<SavedFilter, "situacoes" | "setores" | "criterios">,
): Partial<OsSearchFilters> {
  const c = normalizeSavedFilterCriterios(filter.criterios);
  return {
    nrOs: c.nr_os ?? undefined,
    anos: c.anos,
    processo: c.processo ? formatProcessoMask(c.processo) : "",
    categorias: c.categorias,
    solicitantes: c.solicitantes,
    solicitante: "",
    titulo: c.titulo,
    produtos: c.produtos,
    produto: "",
    maquinas: c.maquinas,
    prioridade: c.prioridade,
    situacao: filter.situacoes ?? [],
    setor: filter.setores ?? [],
    page: 1,
  };
}

export function userDefaultToOsPatch(
  data: UserFiltersDefault,
): Partial<OsSearchFilters> | null {
  const c = normalizeSavedFilterCriterios(data.criterios);
  const hasSituacao = (data.situacoes?.length ?? 0) > 0;
  const hasSetor = (data.setores?.length ?? 0) > 0;
  const hasExtra =
    c.nr_os != null ||
    c.anos.length > 0 ||
    Boolean(c.processo.trim()) ||
    c.categorias.length > 0 ||
    c.solicitantes.length > 0 ||
    Boolean(c.titulo.trim()) ||
    c.produtos.length > 0 ||
    c.maquinas.length > 0 ||
    c.prioridade.length > 0;
  if (!hasSituacao && !hasSetor && !hasExtra) {
    return null;
  }
  return savedFilterToOsPatch({
    situacoes: data.situacoes ?? [],
    setores: data.setores ?? [],
    criterios: c,
  });
}

export function hasAnySavedFilterCriteria(filter: SavedFilter): boolean {
  if ((filter.situacoes?.length ?? 0) > 0 || (filter.setores?.length ?? 0) > 0) {
    return true;
  }
  const c = normalizeSavedFilterCriterios(filter.criterios);
  return (
    c.nr_os != null ||
    c.anos.length > 0 ||
    Boolean(c.processo.trim()) ||
    c.categorias.length > 0 ||
    c.solicitantes.length > 0 ||
    Boolean(c.titulo.trim()) ||
    c.produtos.length > 0 ||
    c.maquinas.length > 0 ||
    c.prioridade.length > 0
  );
}
