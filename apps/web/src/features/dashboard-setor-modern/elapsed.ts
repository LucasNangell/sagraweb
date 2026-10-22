/** Datas e carimbos da observação usam Brasília, independentemente do terminal. */
export function parseAndamentoTime(
  value?: string | null,
  observation?: string | null,
): number | null {
  if (!value?.trim()) return null;
  let normalized = value.trim().replace(" ", "T");
  // Registros legados guardam somente a data (serializada também como meia-noite).
  // O servidor registra a hora real no início da observação: HHhMM + quebra de linha.
  const dateWithoutTime = normalized.match(
    /^(\d{4}-\d{2}-\d{2})(?:T00:00(?::00(?:\.0+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/i,
  );
  const observationTime = observation?.match(
    /^\s*([01]?\d|2[0-3])h([0-5]\d)(?!\d)/i,
  );
  if (dateWithoutTime && observationTime) {
    normalized = `${dateWithoutTime[1]}T${observationTime[1]!.padStart(2, "0")}:${observationTime[2]}:00-03:00`;
  }
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
