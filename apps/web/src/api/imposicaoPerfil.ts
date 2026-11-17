import { apiFetch, apiUrl } from "@/api/client";
import type {
  ComparacaoResultado,
  ImposicaoVariante,
  ImposicaoVariantesResponse,
  MarcasArquivo,
  ModeloPerfil,
  PdfInfo,
  PerfilImposicao,
  PerfilRegistro,
  PerfilValidacao,
  PerfisProdutoResponse,
  PreviaJuntada,
  StatusPerfis,
} from "@/features/papelaria/imposicao/perfil/types";

const JSON_HEADERS = { "Content-Type": "application/json" };

function qsProduto(produto: string): string {
  return new URLSearchParams({ produto }).toString();
}

export async function fetchImposicaoStatus(): Promise<StatusPerfis> {
  const res = await apiFetch<{ produtos: StatusPerfis }>("/papelaria/admin/imposicao/status");
  return res.produtos ?? {};
}

export async function fetchPerfisProduto(produto: string): Promise<PerfisProdutoResponse> {
  return apiFetch<PerfisProdutoResponse>(
    `/papelaria/admin/imposicao/perfis?${qsProduto(produto)}`,
  );
}

export async function salvarPerfil(
  produto: string,
  variante: ImposicaoVariante,
  perfil: PerfilImposicao,
): Promise<PerfilRegistro> {
  return apiFetch<PerfilRegistro>(
    `/papelaria/admin/imposicao/perfis/${variante}?${qsProduto(produto)}`,
    { method: "PUT", headers: JSON_HEADERS, body: JSON.stringify({ perfil }) },
  );
}

export async function removerPerfil(
  produto: string,
  variante: ImposicaoVariante,
): Promise<{ deleted: boolean }> {
  return apiFetch<{ deleted: boolean }>(
    `/papelaria/admin/imposicao/perfis/${variante}?${qsProduto(produto)}`,
    { method: "DELETE" },
  );
}

export async function ativarPerfil(
  produto: string,
  variante: ImposicaoVariante,
  ativo: boolean,
): Promise<PerfilRegistro> {
  return apiFetch<PerfilRegistro>(
    `/papelaria/admin/imposicao/perfis/${variante}/ativar?${qsProduto(produto)}`,
    { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ ativo }) },
  );
}

export async function compararPerfil(
  produto: string,
  variante: ImposicaoVariante,
  perfil: PerfilImposicao,
  paginaMm?: { largura: number; altura: number } | null,
): Promise<ComparacaoResultado> {
  return apiFetch<ComparacaoResultado>(
    `/papelaria/admin/imposicao/perfis/${variante}/comparar?${qsProduto(produto)}`,
    {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        perfil,
        pagina_largura_mm: paginaMm?.largura ?? null,
        pagina_altura_mm: paginaMm?.altura ?? null,
      }),
    },
  );
}

export async function validarPerfil(
  perfil: PerfilImposicao,
): Promise<PerfilValidacao & { perfil: PerfilImposicao | null; resumo: string | null }> {
  return apiFetch(`/papelaria/admin/imposicao/validar`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ perfil }),
  });
}

export async function fetchPdfInfo(path: string): Promise<PdfInfo> {
  return apiFetch<PdfInfo>(`/papelaria/admin/imposicao/pdf-info`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ path }),
  });
}

export function pdfThumbUrl(path: string): string {
  return apiUrl(`/papelaria/admin/imposicao/pdf-thumb?${new URLSearchParams({ path })}`);
}

/** Envia o PDF de marcas para o servidor (fica guardado lá). */
export async function enviarMarcasPdf(file: File): Promise<MarcasArquivo> {
  const form = new FormData();
  form.append("file", file, file.name);
  return apiFetch<MarcasArquivo>("/papelaria/admin/imposicao/marcas-pdf", {
    method: "POST",
    body: form,
  });
}

/** Copia para o servidor um PDF referenciado hoje por caminho de rede. */
export async function importarMarcasPdf(path: string): Promise<MarcasArquivo> {
  return apiFetch<MarcasArquivo>("/papelaria/admin/imposicao/marcas-pdf/importar", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ path }),
  });
}

export async function fetchMarcasArquivoInfo(arquivo: string): Promise<MarcasArquivo> {
  return apiFetch<MarcasArquivo>(
    `/papelaria/admin/imposicao/marcas-pdf/${encodeURIComponent(arquivo)}/info`,
  );
}

export function marcasPdfUrl(arquivo: string): string {
  return apiUrl(`/papelaria/admin/imposicao/marcas-pdf/${encodeURIComponent(arquivo)}`);
}

export function marcasThumbUrl(arquivo: string): string {
  return apiUrl(`/papelaria/admin/imposicao/marcas-pdf/${encodeURIComponent(arquivo)}/thumb`);
}

export async function fetchModelosPerfil(): Promise<ModeloPerfil[]> {
  const res = await apiFetch<{ modelos: ModeloPerfil[] }>(
    "/papelaria/admin/imposicao/modelos-perfil",
  );
  return res.modelos ?? [];
}

export async function salvarModeloPerfil(
  nome: string,
  perfil: PerfilImposicao,
): Promise<ModeloPerfil> {
  return apiFetch<ModeloPerfil>("/papelaria/admin/imposicao/modelos-perfil", {
    method: "PUT",
    headers: JSON_HEADERS,
    body: JSON.stringify({ nome, perfil }),
  });
}

export async function removerModeloPerfil(id: number): Promise<{ deleted: boolean }> {
  return apiFetch<{ deleted: boolean }>(`/papelaria/admin/imposicao/modelos-perfil/${id}`, {
    method: "DELETE",
  });
}

export async function fetchImposicaoVariantesOs(
  ano: number,
  nro: number,
  modeloId: number,
): Promise<ImposicaoVariantesResponse> {
  const qs = new URLSearchParams({ modelo_id: String(modeloId) });
  return apiFetch<ImposicaoVariantesResponse>(
    `/papelaria/os/${ano}/${nro}/imposicao-variantes?${qs}`,
  );
}

export async function fetchPreviaJuntada(
  ano: number,
  nro: number,
  payload: {
    modelo_id: number;
    variante: ImposicaoVariante;
    juntada_os: Array<{ ano: number; nro: number }>;
  },
): Promise<PreviaJuntada> {
  return apiFetch<PreviaJuntada>(`/papelaria/os/${ano}/${nro}/imposicao/previa-juntada`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(payload),
  });
}
