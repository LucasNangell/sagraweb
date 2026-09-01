export type PapelariaAlteracaoIdentity = {
  job_id?: number | null;
  versao?: string | null;
  campos?: Record<string, string> | null;
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
