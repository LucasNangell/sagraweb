export const GRAVACAO_EXTERNA_SITUACAO = "Gravação Externa"; // legado
export const GRAVACAO_PENDENTE_SITUACAO = "Gravação Pendente";
export const GRAVACAO_SAIDA_P_SITUACAO = "Saída p/";
export const GRAVACAO_RECEBIDO_SITUACAO = "Recebido";
export const GRAVACAO_CONCLUIDA_SITUACAO = "Gravação Ext. Concluída";
export const SETOR_GRAV_EXTERNA = "Grav. Externa";
export const SETOR_GRAVACAO_PENDENTE = "SEGEP";
export const SETOR_GRAVACAO_ENTREGA = "Gravação";

export const GRAVACAO_EXTERNA_ALLOWED_EXTENSIONS = [".pdf", ".tif", ".tiff"];

export function isGravacaoExternaFile(name: string): boolean {
  const ext = name.includes(".") ? `.${name.split(".").pop()?.toLowerCase()}` : "";
  return GRAVACAO_EXTERNA_ALLOWED_EXTENSIONS.includes(ext);
}

export function isGravacaoPendenteSituacao(situacao: string | null | undefined): boolean {
  return String(situacao || "").trim() === GRAVACAO_PENDENTE_SITUACAO;
}

export function isGravacaoExternaSituacao(situacao: string | null | undefined): boolean {
  return String(situacao || "").trim() === GRAVACAO_EXTERNA_SITUACAO;
}

export function isEmGravacaoExternaOperacional(
  situacao: string | null | undefined,
  setor: string | null | undefined,
): boolean {
  const sit = String(situacao || "").trim();
  const setr = String(setor || "").trim();
  if (sit === GRAVACAO_EXTERNA_SITUACAO) return true;
  return (
    setr === SETOR_GRAV_EXTERNA &&
    (sit === GRAVACAO_SAIDA_P_SITUACAO || sit === GRAVACAO_RECEBIDO_SITUACAO)
  );
}

export function canAlterarArquivosGravacaoExterna(
  detail: { status: string } | null | undefined,
): boolean {
  return detail?.status === "pendente";
}

export function canAlterarArquivosGravacaoPendente(
  detail: { status: string } | null | undefined,
): boolean {
  return detail?.status === "ativa";
}
