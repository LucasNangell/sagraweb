/** Datas sem offset vêm do banco no horário de Brasília, independentemente do terminal. */
export function parseAndamentoTime(value?: string | null): number | null {
  if (!value?.trim()) return null;
  let normalized = value.trim().replace(" ", "T");
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(normalized)) return null;
  if (!/(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalized)) normalized += "-03:00";
  const timestamp = Date.parse(normalized);
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function elapsedParts(timestamp: number | null, now: number) {
  if (timestamp == null || timestamp > now) return null;
  const totalSeconds = Math.floor((now - timestamp) / 1000);
  return {
    days: Math.floor(totalSeconds / 86400),
    hours: String(Math.floor(totalSeconds / 3600) % 24).padStart(2, "0"),
    minutes: String(Math.floor(totalSeconds / 60) % 60).padStart(2, "0"),
    seconds: String(totalSeconds % 60).padStart(2, "0"),
    totalSeconds,
  };
}
