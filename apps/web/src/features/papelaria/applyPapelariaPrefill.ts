export type PapelariaAlteracaoIdentity = {
  job_id?: number | null;
  versao?: string | null;
  campos?: Record<string, string> | null;
};

export type PapelariaAlteracaoPendingJob = {
  id: number;
  status: string;
  versao?: number | null;
  tipo_job?: string | null;
  prova_revisao?: string | null;
};

export function clienteAlteracaoIdentity(
  alt: PapelariaAlteracaoIdentity | null | undefined,
): string | null {
  const campos = alt?.campos;
  if (!campos || Object.keys(campos).length === 0) {
    return null;
  }
  const camposKey = JSON.stringify(
    Object.keys(campos)
      .sort()
      .map((key) => [key, campos[key]]),
  );
  return `${alt?.job_id ?? ""}:${alt?.versao ?? ""}:${camposKey}`;
}

/**
 * Destaque "(alterado pelo cliente)" só enquanto não existir prova completed
 * mais nova que o pedido de alteração.
 */
export function isClienteAlteracaoPendente(
  alt: Pick<PapelariaAlteracaoIdentity, "job_id" | "versao"> | null | undefined,
  jobs: PapelariaAlteracaoPendingJob[] | null | undefined,
): boolean {
  if (!alt) return false;
  const altVer = Number(alt.versao);
  const altJobId = Number(alt.job_id);
  const latest = [...(jobs ?? [])]
    .filter(
      (job) =>
        job.status === "completed" &&
        job.tipo_job !== "imposicao" &&
        job.tipo_job !== "timbrado_a4_digital" &&
        (job.prova_revisao || "").trim() !== "discarded",
    )
    .sort((a, b) => b.id - a.id)[0];
  if (!latest) return true;
  const jobVer = Number(latest.versao);
  if (Number.isFinite(altVer) && altVer > 0 && Number.isFinite(jobVer) && jobVer > altVer) {
    return false;
  }
  if (
    Number.isFinite(altJobId) &&
    altJobId > 0 &&
    Number.isFinite(latest.id) &&
    latest.id > altJobId
  ) {
    return false;
  }
  return true;
}

/**
 * Mescla prefill da OS com valores já no formulário.
 * Com alteração do cliente, os campos informados pelo cliente prevalecem
 * sobre prefill da API e sobre o estado atual (ex.: cache stale).
 */
export function mergePapelariaFieldValues(
  current: Record<string, string>,
  prefill: Record<string, string> | undefined,
  clienteCampos?: Record<string, string> | null,
): Record<string, string> {
  const hasCliente = Boolean(
    clienteCampos && Object.keys(clienteCampos).length > 0,
  );
  if (hasCliente) {
    return { ...current, ...(prefill ?? {}), ...clienteCampos };
  }
  if (!prefill || Object.keys(prefill).length === 0) {
    return current;
  }
  return { ...prefill, ...current };
}

/** Campos do cliente que vão para o formulário (sem as chaves internas `__*`). */
export function camposClienteFormulario(
  campos: Record<string, string> | null | undefined,
): Record<string, string> | null {
  if (!campos) return null;
  const out = Object.fromEntries(Object.entries(campos).filter(([k]) => !k.startsWith("__")));
  return Object.keys(out).length ? out : null;
}

export type InternosCliente = {
  /** Textos editados na prévia (`modelo:pagina:marcador` → texto). */
  textos: Record<string, string> | null;
  /** Redes marcadas, na ordem. */
  redes: Array<{ chave: string; valor: string }> | null;
  redesEstilo: string | null;
  /** Campos extras (`__campos_extras`) e estilo de campos do modelo. */
  camposExtrasRaw: string | null;
  camposEstiloRaw: string | null;
};

function lerJson(raw: string | undefined): unknown {
  if (!raw?.trim()) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

/** Lê `__textos`, `__redes`, `__redes_estilo`, `__campos_extras` e `__campos_estilo`. */
export function internosCliente(internos: Record<string, string> | null | undefined): InternosCliente {
  const textosRaw = lerJson(internos?.["__textos"]);
  const textos =
    textosRaw && typeof textosRaw === "object" && !Array.isArray(textosRaw)
      ? Object.fromEntries(
          Object.entries(textosRaw as Record<string, unknown>).map(([k, v]) => [k, String(v ?? "")]),
        )
      : null;
  const redesRaw = lerJson(internos?.["__redes"]);
  const redes = Array.isArray(redesRaw)
    ? redesRaw
        .filter((r): r is { chave: unknown; valor?: unknown } => Boolean(r) && typeof r === "object" && "chave" in r)
        .map((r) => ({ chave: String(r.chave ?? "").toLowerCase(), valor: String(r.valor ?? "") }))
        .filter((r) => r.chave)
    : null;
  const estilo = internos?.["__redes_estilo"]?.trim() || null;
  const camposExtrasRaw = internos?.["__campos_extras"]?.trim() || null;
  const camposEstiloRaw = internos?.["__campos_estilo"]?.trim() || null;
  return {
    textos: textos && Object.keys(textos).length ? textos : null,
    redes,
    redesEstilo: estilo,
    camposExtrasRaw,
    camposEstiloRaw,
  };
}
