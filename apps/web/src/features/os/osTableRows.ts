import type { OsSearchRow, SubOsRow } from "./types";

export function osRowKey(row: Pick<OsSearchRow, "ano" | "nr_os">): string {
  return `${row.ano}-${row.nr_os}`;
}

/** Chave estável para seleção / virtualização (main vs sub). */
export function selectionRowKey(row: OsSearchRow): string {
  if (row.kind === "sub_os" || row.is_sub_os) {
    const parentAno = row.parent_ano ?? row.ano;
    const parentNro = row.parent_nr_os ?? row.nr_os;
    return `sub:${parentAno}:${parentNro}:${row.sub_os_id ?? "?"}`;
  }
  return `main:${row.ano}:${row.nr_os}`;
}

export function displayRowId(row: OsSearchRow): string {
  return selectionRowKey(row);
}

export function isSameOsSelection(
  a: OsSearchRow | null,
  b: OsSearchRow | null,
): boolean {
  if (!a || !b) {
    return false;
  }
  return selectionRowKey(a) === selectionRowKey(b);
}

function subRowCacheKey(parent: OsSearchRow, sub: SubOsRow): string {
  return [
    parent.ano,
    parent.nr_os,
    sub.id,
    sub.situacao_atual ?? sub.situacao ?? "",
    sub.setor_atual ?? sub.setor ?? "",
    sub.data_atual ?? sub.data ?? "",
    sub.congelada ? "1" : "0",
    sub.display_name ?? sub.componente_nome ?? "",
  ].join("|");
}

const subDisplayRowCache = new Map<string, OsSearchRow>();

function buildSubOsDisplayRow(
  parent: OsSearchRow,
  sub: SubOsRow,
): OsSearchRow {
  const cacheKey = subRowCacheKey(parent, sub);
  const cached = subDisplayRowCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const row: OsSearchRow = {
    ...parent,
    kind: "sub_os",
    is_sub_os: true,
    sub_os_id: sub.id,
    componente_id: sub.componente_id,
    componente_nome: sub.componente_nome,
    display_label: sub.display_name,
    parent_nr_os: parent.nr_os,
    parent_ano: parent.ano,
    situacao: sub.situacao_atual ?? sub.situacao ?? null,
    setor: sub.setor_atual ?? sub.setor ?? null,
    data_entrega: sub.data_atual ?? sub.data ?? null,
    congelada: sub.congelada,
  };
  subDisplayRowCache.set(cacheKey, row);
  return row;
}

export function buildDisplayRows(
  rows: OsSearchRow[],
  expanded: ReadonlySet<string>,
  subOsByParent: ReadonlyMap<string, SubOsRow[]>,
): OsSearchRow[] {
  const result: OsSearchRow[] = [];
  for (const row of rows) {
    result.push(
      row.kind === "sub_os" || row.is_sub_os
        ? row
        : { ...row, kind: "main_os" as const },
    );
    const key = osRowKey(row);
    if (!expanded.has(key)) {
      continue;
    }
    const subs = subOsByParent.get(key) ?? [];
    for (const sub of subs) {
      result.push(buildSubOsDisplayRow(row, sub));
    }
  }
  return result;
}

/** Normaliza linha selecionada para o store (main vs sub). */
export function normalizeOsSelection(row: OsSearchRow): OsSearchRow {
  if (row.kind === "sub_os" || row.is_sub_os) {
    return {
      ...row,
      kind: "sub_os",
      is_sub_os: true,
      parent_ano: row.parent_ano ?? row.ano,
      parent_nr_os: row.parent_nr_os ?? row.nr_os,
      sub_os_id: row.sub_os_id,
      componente_id: row.componente_id,
      componente_nome: row.componente_nome,
      display_label:
        row.display_label ??
        (row.componente_nome
          ? `${row.parent_nr_os ?? row.nr_os} [${row.componente_nome}]`
          : undefined),
    };
  }

  const {
    kind: _kind,
    is_sub_os: _isSub,
    sub_os_id: _subId,
    componente_id: _compId,
    componente_nome: _compNome,
    display_label: _label,
    parent_nr_os: _parentNro,
    parent_ano: _parentAno,
    congelada: _cong,
    ...rest
  } = row;

  return {
    ...rest,
    kind: "main_os",
  };
}

/** OS principal ainda presente na página de busca (Sub OS depende do pai). */
export function isParentOsInSearchResults(
  selected: OsSearchRow,
  rows: OsSearchRow[],
): boolean {
  if (!selected.is_sub_os && selected.kind !== "sub_os") {
    return rows.some(
      (r) =>
        !r.is_sub_os &&
        r.kind !== "sub_os" &&
        r.nr_os === selected.nr_os &&
        r.ano === selected.ano,
    );
  }

  const parentAno = selected.parent_ano ?? selected.ano;
  const parentNro = selected.parent_nr_os ?? selected.nr_os;
  return rows.some(
    (r) =>
      !r.is_sub_os &&
      r.kind !== "sub_os" &&
      r.nr_os === parentNro &&
      r.ano === parentAno,
  );
}

/** Converte seleção Sub OS de volta para a OS principal (lista). */
export function toMainOsSelection(row: OsSearchRow): OsSearchRow {
  if (!row.is_sub_os && row.kind !== "sub_os") {
    return normalizeOsSelection(row);
  }
  const {
    kind: _kind,
    is_sub_os: _isSub,
    sub_os_id: _subId,
    componente_id: _compId,
    componente_nome: _compNome,
    display_label: _label,
    parent_nr_os,
    parent_ano,
    congelada: _cong,
    ...rest
  } = row;
  return normalizeOsSelection({
    ...rest,
    nr_os: parent_nr_os ?? row.nr_os,
    ano: parent_ano ?? row.ano,
  });
}
