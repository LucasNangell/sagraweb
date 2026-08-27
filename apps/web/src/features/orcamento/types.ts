export interface OrcamentoOsMeta {
  nro_protocolo?: number | null;
  ano_protocolo?: number | null;
  titulo: string;
  solicitante: string;
  processo: string;
  data_entrada: string;
  produto: string;
  formato_os: string;
  maquina: string;
  papel_os: string;
  cores_os: string;
  acabamento_os: string;
  formato_sugerido?: string | null;
}

export interface OrcamentoComponente {
  nome: string;
  tipo: string;
  menor_mm: number;
  maior_mm: number;
  paginas: number;
  cor: boolean;
  frente_verso: boolean;
  verso_cor: boolean;
  papel_codigo?: string | null;
  papel_nome_os?: string | null;
  laminacao: boolean;
  laminacao_fv: boolean;
  espiral: boolean;
  grampo: boolean;
  cola: boolean;
  capa_pvc: boolean;
  espiral_codigo?: string | null;
  verniz: number;
  faca_cliche: number;
}

export interface OrcamentoEntrada {
  os: OrcamentoOsMeta;
  tiragem: number;
  tecnologia: "digital" | "offset" | "auto" | string;
  componentes: OrcamentoComponente[];
  observacoes?: string;
}

export interface OrcamentoPapelOpcao {
  codigo: string;
  especificacao: string;
  preco_unitario: number;
  rendimento_a4?: number | null;
}

export interface OrcamentoLinhaIndireto {
  nome: string;
  aliquota: number;
  valor: number;
}

export interface OrcamentoPessoalDetalhe {
  passo_id?: number | null;
  nome?: string | null;
  setor_link?: string | null;
  tipo?: string | null;
  cobra_pessoal?: boolean;
  horas_prior?: number;
  horas?: number;
  horas_obs?: number;
  n_amostras?: number;
  fonte?: string;
  valor: number;
  capped?: boolean;
}

export interface OrcamentoComponenteResultado {
  nome: string;
  tipo: string;
  formato: string;
  paginas: number;
  cor: boolean;
  papel_codigo?: string | null;
  papel_especificacao?: string | null;
  a4_equivalentes: number;
  folhas_matriz: number;
  custo_papel: number;
  custo_clique: number;
  qtd_chapas: number;
  custo_pre: number;
  custo_tinta: number;
  custo_acabamento: number;
  alertas?: string[];
}

export interface OrcamentoConsolidado {
  tecnologia: string;
  custo_papel: number;
  custo_clique: number;
  custo_pre: number;
  custo_tinta: number;
  custo_acabamento: number;
  custo_direto: number;
  custo_indiretos: number;
  custo_pessoal?: number;
  pessoal_detalhe?: OrcamentoPessoalDetalhe[];
  indiretos_detalhe: OrcamentoLinhaIndireto[];
  usa_pessoal_hora?: boolean;
  total: number;
  unitario: number;
  por_cento_paginas: number;
  componentes: OrcamentoComponenteResultado[];
}

export interface OrcamentoResultado {
  tiragem: number;
  tecnologia_solicitada: string;
  tecnologia_escolhida: string;
  mais_economica: string;
  digital: OrcamentoConsolidado;
  offset: OrcamentoConsolidado;
  escolhido: OrcamentoConsolidado;
  total: number;
  unitario: number;
  alertas: string[];
}

export interface OrcamentoEspecificacaoLinha {
  label: string;
  valor: string;
}

export interface OrcamentoEspecificacaoGrupo {
  titulo: string;
  linhas: OrcamentoEspecificacaoLinha[];
}

export interface OrcamentoOficio {
  solicitante: string;
  titulo: string;
  processo: string;
  numero?: number | null;
  ano?: number | null;
  os_numero?: number;
  os_ano?: number;
  data_entrada?: string;
  especificacao: string;
  especificacao_grupos?: OrcamentoEspecificacaoGrupo[];
  paginas: number;
  tiragem: number;
  valor_total: number;
  tecnologia_label: string;
  validade_dias: number;
  prazo_entrega_dias: number;
  clausula_validade: string;
  clausula_entrega: string;
  signatario: string;
  cargo: string;
  endereco: string;
  telefone: string;
}

export interface OrcamentoComparativo {
  tem_realizado: boolean;
  situacao?: string;
  estimado: {
    fonte?: string;
    total?: number;
    custo_pessoal?: number;
    custo_material?: number;
    pessoal_detalhe?: OrcamentoPessoalDetalhe[];
  };
  estimado_fonte?: string;
  realizado?: {
    total?: number;
    custo_pessoal?: number;
    custo_material?: number;
    desperdicio?: number;
    tem_estoque?: boolean;
    nota_material?: string | null;
    pessoal_detalhe?: OrcamentoPessoalDetalhe[];
    horas_produtivas?: number;
  } | null;
  delta?: number | null;
  confianca?: { n: number; k: number; rotulo: string };
  computed_at?: string;
}

export interface OrcamentoResponse {
  entrada: OrcamentoEntrada;
  opcoes?: { papeis: OrcamentoPapelOpcao[]; espirais?: OrcamentoPapelOpcao[] };
  resultado: OrcamentoResultado;
  oficio: OrcamentoOficio;
  parametros?: Record<string, unknown>;
  comparativo?: OrcamentoComparativo | null;
}
