import type { OsSearchRow } from "@/features/os/types";

import {
  readPapelariaSession,
  type PapelariaSessionContext,
} from "./papelariaSession";

/** Monta um stub de seleção a partir do sessionStorage da Papelaria. */
export function osRowFromPapelariaSession(
  session: PapelariaSessionContext = readPapelariaSession(),
): OsSearchRow | null {
  if (!session.osId || !session.osAno) return null;
  const nr_os = parseInt(session.osId, 10);
  const ano = parseInt(session.osAno, 10);
  if (!Number.isFinite(nr_os) || !Number.isFinite(ano)) return null;
  return {
    nr_os,
    ano,
    produto: session.targetProduct,
  };
}

export function sameOsRow(
  a: Pick<OsSearchRow, "nr_os" | "ano"> | null | undefined,
  b: Pick<OsSearchRow, "nr_os" | "ano"> | null | undefined,
): boolean {
  if (!a || !b) return false;
  return a.nr_os === b.nr_os && a.ano === b.ano;
}
