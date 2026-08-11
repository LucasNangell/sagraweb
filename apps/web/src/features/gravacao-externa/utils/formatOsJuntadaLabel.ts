/** Formata OS no estilo das listas de gravação: 12345/26 */
export function formatOsListLabel(nrOs: number, ano: number): string {
  return `${String(nrOs).padStart(5, "0")}/${String(ano).slice(-2)}`;
}

/** Rótulo composto para juntada: "12345/26 e 65432/26" */
export function formatOsJuntadaLabel(
  membros: { nr_os: number; ano: number }[] | null | undefined,
  fallback?: { nr_os: number; ano: number },
): string {
  const list =
    membros && membros.length > 0
      ? [...membros].sort((a, b) => a.nr_os - b.nr_os || a.ano - b.ano)
      : fallback
        ? [fallback]
        : [];
  const labels = list.map((m) => formatOsListLabel(m.nr_os, m.ano));
  if (labels.length === 0) return "";
  if (labels.length === 1) return labels[0];
  if (labels.length === 2) return `${labels[0]} e ${labels[1]}`;
  return `${labels.slice(0, -1).join(", ")} e ${labels[labels.length - 1]}`;
}

/** Subtítulo do card nas listas de /gravacao-externa. */
export function formatOsCardSubtitle(item: {
  juntada_grupo_id?: string | null;
  membros?: { nr_os: number; ano: number }[] | null;
  solicitante?: string | null;
  produto?: string | null;
}): string {
  if (item.juntada_grupo_id && (item.membros?.length ?? 0) > 1) {
    return "Juntada de OPs";
  }
  const base = item.solicitante || "—";
  return item.produto ? `${base} · ${item.produto}` : base;
}
