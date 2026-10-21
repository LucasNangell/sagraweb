export const SEPARADOR_CAD_MIN = 1;
export const SEPARADOR_CAD_MAX = 99;

export function formatSeparadorOs(nrOs: number, ano: number): string {
  return `${nrOs}/${ano}`;
}

export function formatSeparadorMeta(value: string | null | undefined): string {
  const trimmed = String(value ?? "").trim();
  return trimmed || "—";
}

export function formatCadNumero(n: number): string {
  return String(n).padStart(2, "0");
}

export type CadUntilResult =
  | { ok: true; until: number }
  | { ok: false; message: string };

export function parseCadUntil(raw: string): CadUntilResult {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { ok: false, message: "Informe até qual caderno gerar." };
  }
  if (!/^\d+$/.test(trimmed)) {
    return { ok: false, message: "Informe um número inteiro." };
  }
  const until = Number(trimmed);
  if (until < SEPARADOR_CAD_MIN || until > SEPARADOR_CAD_MAX) {
    return {
      ok: false,
      message: `Informe um número de ${SEPARADOR_CAD_MIN} a ${SEPARADOR_CAD_MAX}.`,
    };
  }
  return { ok: true, until };
}

export function cadSequence(until: number): string[] {
  const parsed = parseCadUntil(String(until));
  if (!parsed.ok) {
    return [];
  }
  return Array.from({ length: parsed.until }, (_, i) => formatCadNumero(i + 1));
}
