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
  /** Se true, o texto resolvido do campo é gravado em maiúsculas no PDF. */
  uppercase?: boolean;
  /** Se true, o texto não pode ser editado na prévia (clique no PDF). */
  bloquear_edicao?: boolean;
  /** Textos do PDF (abaixo deste, mesma página) que formam um campo só com ele. */
  juntar?: string[];
  /** Grupo de campos (id) — o alinhamento passa a ser o do grupo. */
  grupo?: string | null;
}

export type ProvaPdfRedesDisposicao = "vertical" | "horizontal" | "grade";

/** Bloco de redes sociais do modelo (área do PDF + layout). */
export interface ProvaPdfBlocoRedes {
  ativo: boolean;
  pagina: number;
  /** Área em pontos do PDF: [x0, y0, x1, y1]. */
  area: [number, number, number, number];
  /** Linhas de exemplo das redes no PDF (apagadas na prova). */
  marcadores: string[];
  /** Linha que define fonte, tamanho e cor do texto das redes. */
  fonte_marcador: string;
  disposicao: ProvaPdfRedesDisposicao;
  alinhamento_h: "esquerda" | "centro" | "direita";
  alinhamento_v: "topo" | "meio" | "base";
  icone_mm: number;
  espaco_mm: number;
  gap_mm: number;
  max: number;
  /** Redes aceitas (vazio = todas as ativas do catálogo). */
  permitidas: string[];
  /** Estilo de logo que já vem selecionado na página Papelaria. */
  estilo_padrao?: "quadrado_policromia" | "quadrado_pb" | "policromia" | "pb";
}

/**
 * Grupo de campos (como o bloco de redes sociais): os campos ficam
 * empilhados e o alinhamento vertical/horizontal é do grupo.
 */
export interface ProvaPdfGrupo {
  id: string;
  nome: string;
  /** Vertical: topo (cresce para baixo), base (para cima) ou centro. */
  ancora: ProvaPdfAncora;
  /** Horizontal na área que junta os campos (auto = cada campo o seu). */
  alinhamento: ProvaPdfAlinhamento;
}

export interface ProvaPdfModelo {
  tem_pdf: boolean;
  grupos?: ProvaPdfGrupo[];
  arquivo?: string;
  atualizado_em?: string | null;
  campos: ProvaPdfCampo[];
  redes?: ProvaPdfBlocoRedes | null;
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
  options?: { limpar?: boolean; grupos?: ProvaPdfGrupo[] },
): Promise<ProvaPdfModelo> {
  return apiFetch<ProvaPdfModelo>(`${base(modeloId)}/campos`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      campos,
      limpar: Boolean(options?.limpar),
      ...(options?.grupos ? { grupos: options.grupos } : {}),
    }),
  });
}

/** Onde um campo do PDF ficou na prévia (para editar o texto direto nela). */
export interface ProvaPdfRegiao {
  /** `modelo:pagina:marcador` — chave do texto editado. */
  chave: string;
  modelo_id: number;
  /** Página no PDF do modelo (1 = primeira). */
  pagina: number;
  /** Página da prévia (0 = frente). */
  pagina_saida: number;
  marcador: string;
  /** Área em frações da página: [x0, y0, x1, y1], origem no canto superior esquerdo. */
  area: [number, number, number, number];
  /** Texto desenhado (sem as marcas de negrito). */
  texto: string;
  /** Trechos em negrito do texto: [início, fim). */
  negrito: Array<[number, number]>;
  /** Template do campo (linhas sem informação já removidas); vazio quando editado. */
  template: string;
  /** Valores das variáveis do template usados no desenho. */
  valores: Record<string, string>;
  /** O texto foi digitado na prévia (não vem mais do template). */
  editado: boolean;
  /** Região de rede social (bloco `__redes`); ausente = campo PDF normal. */
  tipo?: "campo" | "rede";
  /** Chave do catálogo de redes (`instagram`, `x`, …). */
  rede_chave?: string;
  /** Campo marcado no admin para não permitir edição na prévia. */
  bloquear_edicao?: boolean;
}

export interface ProvaPdfPrevia {
  paginas: string[];
  ms: number;
  avisos?: string[];
  regioes?: ProvaPdfRegiao[];
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
  composicao?: import("@/features/papelaria/types").PapelariaComposicao | null,
): Promise<ProvaPdfPrevia> {
  return apiFetch<ProvaPdfPrevia>(`/papelaria/modelos/${modeloId}/previa-pdf`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(composicao ? { dados, composicao } : { dados }),
    signal,
  });
}


/** Sugere o bloco de redes a partir das linhas de exemplo escolhidas. */
export function detectarBlocoRedes(
  modeloId: number,
  pagina: number,
  marcadores: string[],
): Promise<ProvaPdfBlocoRedes> {
  return apiFetch<ProvaPdfBlocoRedes>(`${base(modeloId)}/redes/detectar`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pagina, marcadores }),
  });
}

/** Grava (ou remove, com null) o bloco de redes sociais do modelo. */
export function salvarBlocoRedes(
  modeloId: number,
  bloco: ProvaPdfBlocoRedes | null,
): Promise<ProvaPdfModelo> {
  return apiFetch<ProvaPdfModelo>(`${base(modeloId)}/redes`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bloco }),
  });
}

/** Repetição de SP: monta a base da nova prova a partir da prova da OS repetida. */
export function replicarSp(
  ano: number,
  nro: number,
  origem?: { ano: number; nro: number } | null,
): Promise<import("@/features/papelaria/types").PapelariaRepeticaoBase> {
  return apiFetch(`/papelaria/os/${ano}/${nro}/repeticao`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(origem ? { origem_ano: origem.ano, origem_nro: origem.nro } : {}),
  });
}

/** Prévia ao vivo da base da repetição (textos editados em `__textos`, chave `0:pagina:marcador`). */
export function previaRepeticao(
  ano: number,
  nro: number,
  dados: Record<string, string>,
  signal?: AbortSignal,
  /** OS antiga só frente: o verso escolhido (modelo) completa a base. */
  composicao?: import("@/features/papelaria/types").PapelariaComposicao | null,
): Promise<ProvaPdfPrevia> {
  return apiFetch<ProvaPdfPrevia>(`/papelaria/os/${ano}/${nro}/repeticao/previa`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(composicao ? { dados, composicao } : { dados }),
    signal,
  });
}

export function descartarRepeticao(ano: number, nro: number): Promise<{ ok: boolean }> {
  return apiFetch(`/papelaria/os/${ano}/${nro}/repeticao`, { method: "DELETE" });
}
