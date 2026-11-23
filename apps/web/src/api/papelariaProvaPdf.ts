import { apiFetch, apiUrl } from "@/api/client";

/** Texto encontrado no PDF do modelo (candidato a campo). */
export interface ProvaPdfTexto {
  marcador: string;
  pagina: number;
  fonte: string;
  tamanho: number;
  cor: string;
  x_mm: number;
  y_mm: number;
  alinhamento_sugerido: "esquerda" | "centro" | "direita";
  ancora_sugerida: "topo" | "base";
  /** Linha com estilos mistos (ex.: nome em negrito): fontes usadas, na ordem. */
  fontes?: string[];
  /** Trechos da linha por estilo (só quando há mais de uma fonte). */
  trechos?: Array<{ texto: string; fonte: string; negrito: boolean }>;
}

export interface ProvaPdfFonte {
  nome: string;
  /** Incorporada em formato que permite escrever texto novo. */
  editavel: boolean;
  /** Tem os caracteres comuns (acentos, números, pontuação). */
  completa: boolean;
  glifos: number;
  faltam: string[];
}

export type ProvaPdfAlinhamento = "auto" | "esquerda" | "centro" | "direita";
export type ProvaPdfAncora = "auto" | "topo" | "base" | "centro";

export interface ProvaPdfCampo {
  marcador: string;
  pagina: number;
  template: string;
  alinhamento: ProvaPdfAlinhamento;
  ancora: ProvaPdfAncora;
  entrelinha: number;
  reduzir_para_caber: boolean;
}

export interface ProvaPdfModelo {
  tem_pdf: boolean;
  arquivo?: string;
  atualizado_em?: string | null;
  campos: ProvaPdfCampo[];
  analise: {
    paginas: Array<{ pagina: number; largura_mm: number; altura_mm: number }>;
    fontes: ProvaPdfFonte[];
    textos: ProvaPdfTexto[];
  } | null;
}

const base = (modeloId: number) => `/papelaria/admin/modelos/${modeloId}/prova-pdf`;

export function fetchProvaPdfModelo(modeloId: number): Promise<ProvaPdfModelo> {
  return apiFetch<ProvaPdfModelo>(base(modeloId));
}

export async function uploadProvaPdfModelo(
  modeloId: number,
  file: File,
): Promise<ProvaPdfModelo> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(apiUrl(base(modeloId)), {
    method: "POST",
    body: form,
    credentials: "include",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    let detail = text;
    try {
      detail = (JSON.parse(text) as { detail?: string }).detail || text;
    } catch {
      /* texto puro */
    }
    throw new Error(detail || `Envio falhou (${res.status})`);
  }
  return res.json() as Promise<ProvaPdfModelo>;
}

export function saveProvaPdfCampos(
  modeloId: number,
  campos: ProvaPdfCampo[],
  options?: { limpar?: boolean },
): Promise<ProvaPdfModelo> {
  return apiFetch<ProvaPdfModelo>(`${base(modeloId)}/campos`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      campos,
      limpar: Boolean(options?.limpar),
    }),
  });
}

export interface ProvaPdfPrevia {
  paginas: string[];
  ms: number;
  avisos?: string[];
}

export function previaProvaPdf(
  modeloId: number,
  dados: Record<string, string>,
): Promise<ProvaPdfPrevia> {
  return apiFetch<ProvaPdfPrevia>(`${base(modeloId)}/previa`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dados }),
  });
}

export function deleteProvaPdfModelo(modeloId: number): Promise<ProvaPdfModelo> {
  return apiFetch<ProvaPdfModelo>(base(modeloId), { method: "DELETE" });
}

/**
 * Prévia ao vivo da página Papelaria: o PDF do modelo com os valores do
 * formulário, renderizado como a prova final (nada é salvo).
 */
export function previaPdfAoVivo(
  modeloId: number,
  dados: Record<string, string>,
  signal?: AbortSignal,
): Promise<ProvaPdfPrevia> {
  return apiFetch<ProvaPdfPrevia>(`/papelaria/modelos/${modeloId}/previa-pdf`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dados }),
    signal,
  });
}
