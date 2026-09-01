import { osSearchQueryKey } from "./osSearchQueryKey";
import { OS_TEXT_SEARCH_MIN_CHARS } from "./osSearchUtils";
import type { OsSearchFilters, OsSearchRow, OsSortColumn } from "./types";

const OS_NR_SP_THRESHOLD = 5000;

/** Há recorte de ano — dá para fatiar a lista já carregada no cliente. */
export function canUseOsHomeLocalView(filters: OsSearchFilters): boolean {
  return (filters.anos?.length ?? 0) > 0 || filters.ano != null;
}

/**
 * Filtros que vão no GET /os/search da home.
 * Com ano, remove visão (situação/setor/etc.) para reutilizar o cache do conjunto.
 */
export function toOsHomeDatasetFilters(filters: OsSearchFilters): OsSearchFilters {
  if (!canUseOsHomeLocalView(filters)) {
    return filters;
  }
  return {
    ...filters,
    nrOs: undefined,
    exactOsLookup: false,
    titulo: "",
    solicitante: "",
    solicitantes: [],
    situacao: [],
    setor: [],
    prioridade: [],
    includeOs: true,
    includeSp: true,
    sortBy: "ano",
    sortDir: "asc",
  };
}

export function osHomePatchTriggersFetch(
  patch: Partial<OsSearchFilters>,
  current: OsSearchFilters,
): boolean {
  const currentKey = osHomeDatasetQueryKey({ ...current, fetchAll: true });
  const nextKey = osHomeDatasetQueryKey({
    ...current,
    ...patch,
    fetchAll: true,
  });
  return currentKey[currentKey.length - 1] !== nextKey[nextKey.length - 1];
}

export function osHomeDatasetQueryKey(filters: OsSearchFilters) {
  return osSearchQueryKey(toOsHomeDatasetFilters(filters));
}

function cleanList(values: string[] | undefined): string[] {
  return (values ?? []).map((v) => v.trim()).filter(Boolean);
}

function displayedAndamentoMatches(
  row: OsSearchRow,
  situacoes: string[],
  setores: string[],
): boolean {
  if (situacoes.length && !situacoes.includes(String(row.situacao ?? "").trim())) {
    return false;
  }
  if (setores.length && !setores.includes(String(row.setor ?? "").trim())) {
    return false;
  }
  return true;
}

function annotateMatchedViaSubOs(
  rows: OsSearchRow[],
  situacoes: string[],
  setores: string[],
): OsSearchRow[] {
  if (!situacoes.length && !setores.length) {
    return rows;
  }
  return rows.map((row) => {
    const mainOk = displayedAndamentoMatches(row, situacoes, setores);
    const matched = Boolean(!mainOk && row.has_sub_os);
    if (row.matched_via_sub_os === matched) {
      return row;
    }
    return { ...row, matched_via_sub_os: matched };
  });
}

/** Filtra linhas já hidratadas (visão). Sem ano, devolve o conjunto do servidor. */
export function applyOsHomeViewFilters(
  rows: OsSearchRow[],
  filters: OsSearchFilters,
): OsSearchRow[] {
  if (!canUseOsHomeLocalView(filters)) {
    return rows;
  }

  const situacoes = cleanList(filters.situacao);
  const setores = cleanList(filters.setor);
  const prioridades = cleanList(filters.prioridade);
  const solicitantes = cleanList(filters.solicitantes);
  const solicitanteTerm = (filters.solicitante ?? "").trim().toLowerCase();
  const nrOs = filters.nrOs;
  const tituloTerm = (filters.titulo ?? "").trim().toLowerCase();
  const tituloActive =
    tituloTerm.length >= OS_TEXT_SEARCH_MIN_CHARS ||
    (tituloTerm.length > 0 &&
      (nrOs != null ||
        (filters.produtos?.length ?? 0) > 0 ||
        solicitantes.length > 0));

  const filtered = rows.filter((row) => {
    const nro = Number(row.nr_os);
    if (!filters.includeOs && nro < OS_NR_SP_THRESHOLD) {
      return false;
    }
    if (!filters.includeSp && nro >= OS_NR_SP_THRESHOLD) {
      return false;
    }
    if (nrOs != null && !Number.isNaN(nrOs) && nro !== nrOs) {
      return false;
    }
    if (!displayedAndamentoMatches(row, situacoes, setores)) {
      return false;
    }
    if (prioridades.length) {
      const prio = String(row.prioridade ?? "").trim();
      if (!prioridades.includes(prio)) {
        return false;
      }
    }
    if (solicitantes.length) {
      const nome = String(row.solicitante ?? "").trim();
      if (!solicitantes.includes(nome)) {
        return false;
      }
    } else if (solicitanteTerm) {
      const nome = String(row.solicitante ?? "").toLowerCase();
      if (!nome.includes(solicitanteTerm)) {
        return false;
      }
    }
    if (tituloActive) {
      const titulo = String(row.titulo ?? "").toLowerCase();
      if (!titulo.includes(tituloTerm)) {
        return false;
      }
    }
    return true;
  });

  return annotateMatchedViaSubOs(filtered, situacoes, setores);
}

function prioRank(prioridade: string | null | undefined): number {
  const prazo = String(prioridade ?? "").trim();
  if (prazo.startsWith("Prometido p/") || prazo === "Prometido p/") {
    return 1;
  }
  if (prazo.startsWith("Solicitado p/") || prazo === "Solicitado p/") {
    return 2;
  }
  return 3;
}

function rowSortDate(row: OsSearchRow): string {
  return String(row.data_entrega || row.data_entrada || "");
}

function cmpText(a: string, b: string): number {
  return a.localeCompare(b, "pt-BR", { numeric: true, sensitivity: "base" });
}

function stableTiebreak(a: OsSearchRow, b: OsSearchRow): number {
  if (a.ano !== b.ano) {
    return b.ano - a.ano;
  }
  return b.nr_os - a.nr_os;
}

function fieldValue(row: OsSearchRow, key: OsSortColumn): string {
  switch (key) {
    case "produto":
      return String(row.produto ?? "");
    case "titulo":
      return String(row.titulo ?? "");
    case "solicitante":
      return String(row.solicitante ?? "");
    case "situacao":
      return String(row.situacao ?? "");
    case "setor":
      return String(row.setor ?? "");
    case "data_entrada":
      return String(row.data_entrada ?? "");
    case "data_entrega":
      return rowSortDate(row);
    default:
      return "";
  }
}

export function sortOsHomeViewRows(
  rows: OsSearchRow[],
  filters: Pick<OsSearchFilters, "sortBy" | "sortDir">,
): OsSearchRow[] {
  const key = (filters.sortBy ?? "") as OsSortColumn | "";
  const dir: 1 | -1 = filters.sortDir === "desc" ? -1 : 1;
  const copy = rows.slice();
  copy.sort((a, b) => {
    if (key === "ano") {
      if (a.ano !== b.ano) {
        return (a.ano - b.ano) * dir;
      }
      return (a.nr_os - b.nr_os) * dir;
    }
    if (key === "nr_os") {
      if (a.nr_os !== b.nr_os) {
        return (a.nr_os - b.nr_os) * dir;
      }
      return (a.ano - b.ano) * dir;
    }
    if (key === "prioridade") {
      const rank = (prioRank(a.prioridade) - prioRank(b.prioridade)) * dir;
      if (rank !== 0) {
        return rank;
      }
      const dates = cmpText(rowSortDate(a), rowSortDate(b)) * dir;
      if (dates !== 0) {
        return dates;
      }
      return stableTiebreak(a, b);
    }
    if (
      key === "produto" ||
      key === "titulo" ||
      key === "solicitante" ||
      key === "situacao" ||
      key === "setor" ||
      key === "data_entrada" ||
      key === "data_entrega"
    ) {
      const byField = cmpText(fieldValue(a, key), fieldValue(b, key)) * dir;
      if (byField !== 0) {
        return byField;
      }
      return stableTiebreak(a, b);
    }
    const rank = prioRank(a.prioridade) - prioRank(b.prioridade);
    if (rank !== 0) {
      return rank;
    }
    const dates = cmpText(rowSortDate(a), rowSortDate(b));
    if (dates !== 0) {
      return dates;
    }
    return stableTiebreak(a, b);
  });
  return copy;
}

/** OPs únicas (nr_os + ano), não linhas de componente. */
export function countUniqueOsProtocols(rows: OsSearchRow[]): number {
  const seen = new Set<string>();
  for (const row of rows) {
    seen.add(`${row.nr_os}-${row.ano}`);
  }
  return seen.size;
}

export function applyOsHomeLocalView(
  rows: OsSearchRow[],
  filters: OsSearchFilters,
): { rows: OsSearchRow[]; totalRecords: number } {
  if (!canUseOsHomeLocalView(filters)) {
    return { rows, totalRecords: countUniqueOsProtocols(rows) };
  }
  const viewed = sortOsHomeViewRows(
    applyOsHomeViewFilters(rows, filters),
    filters,
  );
  return { rows: viewed, totalRecords: countUniqueOsProtocols(viewed) };
}
