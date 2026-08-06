export const GRAVACAO_EXTERNA_SITUACAO = "Gravação Externa";
export const GRAVACAO_PENDENTE_SITUACAO = "Gravação Pendente";

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
