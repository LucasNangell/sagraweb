const MESES_ABREV_PT = [
  "Jan",
  "Fev",
  "Mar",
  "Abr",
  "Mai",
  "Jun",
  "Jul",
  "Ago",
  "Set",
  "Out",
  "Nov",
  "Dez",
] as const;

export function formatAndamentoObsHoraStamp(date: Date, nome: string): string {
  const dd = String(date.getDate()).padStart(2, "0");
  const mmm = MESES_ABREV_PT[date.getMonth()];
  const yy = String(date.getFullYear() % 100).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const nn = String(date.getMinutes()).padStart(2, "0");
  const nomeTrim = nome.trim();
  const suffix = nomeTrim ? ` - ${nomeTrim}` : "";
  return `${dd}/${mmm}/${yy} ${hh}h${nn}${suffix}`;
}

export function insertAndamentoObsHoraStamp(
  obs: string,
  stamp: string,
): { text: string; cursor: number } {
  const suffix = `${stamp}\n`;
  const original = obs.replace(/\n+$/, "");
  if (!original) {
    return { text: suffix, cursor: suffix.length };
  }
  const text = `${original}\n\n${suffix}`;
  return { text, cursor: text.length };
}
