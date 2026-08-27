import type { PapelLombadaItem } from "@/api/auxLookups";

export function papelLombadaKey(p: {
  codPapel: number | null;
  papel: string;
}): string {
  return p.codPapel != null ? `c:${p.codPapel}` : `n:${p.papel}`;
}

export function isLombadaAcabamentoLabel(label: string): boolean {
  const n = stripAccents(label).toLowerCase().trim();
  return n === "lombada" || n.startsWith("lombada ");
}

export function normalizePapelName(value: string): string {
  return stripAccents(value)
    .toLowerCase()
    .replace(/(\d)\s*(g\/m2|g\/m²|gsm|grs|gr|g)\b/g, "$1 g")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function extractGsm(value: string): number | null {
  const n = normalizePapelName(value);
  const match = n.match(/\b(\d{2,4})\s*g\b/) ?? n.match(/\b(\d{2,4})\b/);
  if (!match) return null;
  const gsm = Number(match[1]);
  return Number.isFinite(gsm) && gsm > 0 ? gsm : null;
}

const ALIASES: Record<string, string[]> = {
  cf: ["couche", "fosco"],
  cb: ["couche", "brilho"],
  ap: ["ap", "offset"],
};

function expandTokens(tokens: string[]): string[] {
  const out: string[] = [];
  for (const token of tokens) {
    const alias = ALIASES[token];
    if (alias) out.push(...alias);
    else out.push(token);
  }
  return out;
}

function tokensOf(value: string): string[] {
  return expandTokens(
    normalizePapelName(value)
      .split(" ")
      .filter((t) => t && t !== "g"),
  );
}

function scorePapel(query: string, candidate: string): number {
  const qNorm = normalizePapelName(query);
  const cNorm = normalizePapelName(candidate);
  if (!qNorm || !cNorm) return 0;
  if (qNorm === cNorm) return 100;

  const qGsm = extractGsm(query);
  const cGsm = extractGsm(candidate);
  if (qGsm != null && cGsm != null && qGsm !== cGsm) return 0;

  const qTokens = tokensOf(query);
  const cTokens = new Set(tokensOf(candidate));
  if (qTokens.length === 0) return 0;

  let overlap = 0;
  for (const token of qTokens) {
    if (token === String(qGsm)) {
      if (cGsm === qGsm) overlap += 2;
      continue;
    }
    if (cTokens.has(token)) overlap += 2;
    else if ([...cTokens].some((t) => t.includes(token) || token.includes(t))) {
      overlap += 1;
    }
  }

  if (overlap === 0) return 0;
  if (cNorm.includes(qNorm) || qNorm.includes(cNorm)) overlap += 3;
  return overlap;
}

/** Melhor papel da calculadora para o nome usado na OS (capa/miolo). */
export function matchPapelLombada(
  name: string,
  papeis: PapelLombadaItem[],
): PapelLombadaItem | null {
  const query = name.trim();
  if (!query || papeis.length === 0) return null;

  let best: PapelLombadaItem | null = null;
  let bestScore = 0;
  for (const papel of papeis) {
    const score = scorePapel(query, papel.papel);
    if (score > bestScore) {
      best = papel;
      bestScore = score;
    }
  }
  return bestScore >= 2 ? best : null;
}

function stripAccents(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}
