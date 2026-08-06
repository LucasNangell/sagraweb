/** Catálogo de colunas do relatório personalizado (espelha relatorio.js legado). */
export interface RelatorioFieldDef {
  id: string;
  label: string;
  db: string;
  default?: boolean;
}

export interface RelatorioFieldGroup {
  category: string;
  fields: RelatorioFieldDef[];
}

export const AVAILABLE_FIELDS: RelatorioFieldGroup[] = [
  {
    category: "Identificação",
    fields: [
      { id: "f_nr_os", label: "Número OS", db: "p.NroProtocolo", default: true },
      { id: "f_ano", label: "Ano", db: "p.AnoProtocolo", default: true },
      { id: "f_data_entrada", label: "Data Entrada", db: "p.DataEntrada", default: true },
      { id: "f_situacao", label: "Situação Atual", db: "a.SituacaoLink", default: true },
      { id: "f_setor", label: "Setor Atual", db: "a.SetorLink", default: true },
    ],
  },
  {
    category: "Solicitante",
    fields: [
      { id: "f_nome_usuario", label: "Solicitante (Nome)", db: "p.NomeUsuario", default: true },
      { id: "f_cod_usuario", label: "Cód. Usuário", db: "p.CodUsuarioLink" },
      { id: "f_titular", label: "Titular", db: "p.Titular" },
      { id: "f_orgao", label: "Orgão Interessado", db: "p.OrgInteressado" },
      { id: "f_sigla", label: "Sigla", db: "p.SiglaOrgao" },
      { id: "f_gabinete", label: "Gabinete/Sala", db: "p.GabSalaUsuario" },
      { id: "f_ramal", label: "Ramal", db: "p.RamalUsuario" },
      { id: "f_contato", label: "Contato Trabalho", db: "p.ContatoTrab" },
    ],
  },
  {
    category: "Serviço / Produto",
    fields: [
      { id: "f_titulo", label: "Título", db: "d.Titulo", default: true },
      { id: "f_produto", label: "Produto (Tipo)", db: "d.TipoPublicacaoLink", default: true },
      { id: "f_formato", label: "Formato", db: "d.FormatoLink" },
      { id: "f_maquina", label: "Máquina", db: "d.MaquinaLink" },
      { id: "f_tiragem", label: "Tiragem Final", db: "d.Tiragem", default: true },
      { id: "f_tiragem_sol", label: "Tiragem Solicitada", db: "d.TiragemSolicitada" },
      { id: "f_pags", label: "Páginas", db: "d.Pags" },
      { id: "f_frente_verso", label: "Frente/Verso", db: "d.FrenteVerso" },
      { id: "f_modelos", label: "Qtd. Modelos", db: "d.ModelosArq" },
    ],
  },
  {
    category: "Especificações",
    fields: [
      { id: "f_papel", label: "Papel (Tipo)", db: "d.PapelLink" },
      { id: "f_papel_desc", label: "Papel (Descrição)", db: "d.PapelDescricao" },
      { id: "f_cores", label: "Cores", db: "d.Cores" },
      { id: "f_cores_desc", label: "Cores (Descrição)", db: "d.CoresDescricao" },
      { id: "f_acabamento", label: "Acabamento", db: "d.DescAcabamento" },
      { id: "f_obs", label: "Observações", db: "d.Observ" },
    ],
  },
  {
    category: "Prazos e Entrega",
    fields: [
      { id: "f_prioridade", label: "Prioridade", db: "p.EntregPrazoLink", default: true },
      { id: "f_data_entrega", label: "Data Entrega", db: "p.EntregData", default: true },
      { id: "f_forma_entrega", label: "Forma Entrega", db: "p.EntregaFormaLink" },
      { id: "f_resp_grafica", label: "Resp. Gráfica", db: "p.ResponsavelGrafLink" },
    ],
  },
  {
    category: "Outros",
    fields: [
      { id: "f_processo", label: "Processo", db: "p.ProcessoSolicit" },
      { id: "f_cs", label: "CS", db: "p.CSnro" },
      { id: "f_cota_repro", label: "Cota Repro", db: "p.CotaRepro" },
      { id: "f_cota_cartao", label: "Cota Cartão", db: "p.CotaCartao" },
      { id: "f_midia", label: "Mídia Digital", db: "md.MidiaDigitDescricao" },
    ],
  },
];

export const DEFAULT_SORT_BY = "p.AnoProtocolo DESC, p.NroProtocolo";
