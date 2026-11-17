/**
 * Perfil de imposição v2 — mesmo formato para todos os produtos.
 *
 * Coordenadas dos slots (posicionamento manual): mm, origem no canto
 * superior esquerdo da folha, y para baixo; (x, y) = canto superior esquerdo
 * da área ocupada pelo slot já girado.
 */
export type ImposicaoVariante = "digital" | "offset";
export type Rotacao = 0 | 90 | 180 | 270;
export type FontePagina = "fixa" | "pdf";
export type Faces = "frente" | "frente_verso";
export type Posicionamento = "grade" | "manual";
export type Alinhamento = "centro" | "topo_esquerda";
export type FonteArte = "base_sefoc" | "pre_impresso";
export type RotacaoArte = "no_jdf" | "no_pdf";
export type RegraTiragem = "iguais" | "proporcional_mdc" | "livre";
export type DestinoPdf = "digital" | "offset";
export type Face = "frente" | "verso";

export type PerfilSlot = {
  id: number;
  pagina: number;
  rotacao: Rotacao;
  /** Célula da grade (posicionamento pela grade). */
  col?: number;
  row?: number;
  /** Posição manual (topo-esquerdo, mm). */
  x_mm?: number;
  y_mm?: number;
};

export interface PerfilImposicao {
  versao: 2;
  folha: { largura_mm: number | null; altura_mm: number | null };
  pagina: {
    fonte: FontePagina;
    largura_mm: number | null;
    altura_mm: number | null;
  };
  sangria_mm: number;
  faces: Faces;
  posicionamento: Posicionamento;
  grade: {
    colunas: number;
    linhas: number;
    espaco_h_mm: number;
    espaco_v_mm: number;
    alinhamento: Alinhamento;
  };
  slots: { frente: PerfilSlot[]; verso: PerfilSlot[] };
  marcas: { ativo: boolean; pdf_path: string | null; carimbar_op: boolean };
  arte: { fonte: FonteArte; rotacao: RotacaoArte };
  juntada: {
    ativo: boolean;
    /** null = mesmo andamento da OS que está gerando. */
    situacao_candidatas: string | null;
    produtos_compativeis: string[];
    regra_tiragem: RegraTiragem;
    max_os: number | null;
    preencher_todos_slots: boolean;
  };
  saida: { destino_pdf: DestinoPdf; jdf_hotfolder: string | null };
}

export type ValidacaoItem = { campo: string; mensagem: string };

export type PerfilValidacao = {
  erros: ValidacaoItem[];
  avisos: ValidacaoItem[];
  completo: boolean;
};

export type PerfilRegistro = {
  id: number;
  produto: string;
  variante: ImposicaoVariante;
  perfil: PerfilImposicao | null;
  ativo: boolean;
  aprovado_em: string | null;
  aprovado_por: string | null;
  atualizado_por: string | null;
  atualizado_em: string | null;
  resumo: string | null;
  validacao: PerfilValidacao;
};

export type ConfiguracaoAntigaRascunho = {
  existe: boolean;
  perfil: PerfilImposicao | null;
  /** false = o fluxo antigo completava valores na geração (precisa revisar). */
  completo_no_banco: boolean;
};

export type PerfisProdutoResponse = {
  produto: string;
  digital: PerfilRegistro | null;
  offset: PerfilRegistro | null;
  configuracao_antiga: Record<ImposicaoVariante, ConfiguracaoAntigaRascunho>;
};

export type PosicaoComparada = {
  x_mm: number;
  y_mm: number;
  pagina: number;
  rotacao: number;
};

export type ComparacaoResultado =
  | {
      disponivel: false;
      motivo: string;
      erros?: ValidacaoItem[];
    }
  | {
      disponivel: true;
      iguais: boolean;
      diferencas: Array<{ campo: string; descricao: string }>;
      linhas: Array<{
        face: Face;
        ordem: number;
        antigo: PosicaoComparada | null;
        novo: PosicaoComparada | null;
        igual: boolean;
      }>;
      referencia: PerfilImposicao | null;
    };

export type PdfInfo = {
  path: string;
  existe: boolean;
  paginas: number;
  largura_mm: number | null;
  altura_mm: number | null;
  erro: string | null;
  miniatura?: boolean;
};

export type ModeloPerfil = {
  id: number;
  nome: string;
  perfil: PerfilImposicao;
  resumo: string | null;
  atualizado_em: string | null;
};

export type StatusPerfis = Record<
  string,
  Partial<Record<ImposicaoVariante, { existe: boolean; ativo: boolean }>>
>;

/** Slot com posição resolvida (sistema da tela). */
export type SlotResolvido = {
  id: number;
  pagina: number;
  rotacao: Rotacao;
  x_mm: number;
  y_mm: number;
  largura_mm: number;
  altura_mm: number;
};

/* ---- Diálogo da página Papelaria ---- */

export type VarianteOpcao = {
  disponivel: boolean;
  fonte: "perfil" | "configuracao_antiga" | null;
  resumo: string | null;
  destino_pdf: DestinoPdf | null;
  erros: string[];
};

export type JuntadaCandidata = {
  ano: number;
  nro: number;
  produto: string;
  tiragem: number;
  label: string;
  slots_com_ancora?: number[];
  total_slots_com_ancora?: number;
};

export type JuntadaOpcoes = {
  ancora?: { ano: number; nro: number; produto?: string; tiragem?: number; label?: string };
  situacao?: string;
  max_slots?: number;
  max_os?: number;
  regra?: RegraTiragem | null;
  candidatas: JuntadaCandidata[];
};

export type ImposicaoVariantesResponse = {
  produto: string;
  variantes: Record<ImposicaoVariante, VarianteOpcao>;
  juntada: Partial<Record<ImposicaoVariante, JuntadaOpcoes>>;
  variantes_disponiveis: ImposicaoVariante[];
};

export type PreviaJuntada =
  | { ok: true; slots: number[]; total_slots: number; folhas: number; max_slots: number }
  | { ok: false; mensagem: string };
