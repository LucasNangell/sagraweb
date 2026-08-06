import type { SaveOsPayload } from "@/api/os";

import type { TechSpec } from "./techSpec";
import type { GerenciaFormState, GerenciaSearchParams } from "./types";
import { parseCoefA4Value, parseCotaEstimadaValue } from "./utils";

function val(id: keyof GerenciaFormState, form: GerenciaFormState): string {
  return form[id] as string;
}

function chk(id: keyof GerenciaFormState, form: GerenciaFormState): boolean {
  return Boolean(form[id]);
}

function num(id: keyof GerenciaFormState, form: GerenciaFormState): string | number {
  const v = form[id] as string;
  return v === "" ? 0 : v;
}

export function isGerenciaEditMode(params: GerenciaSearchParams): boolean {
  return Boolean(
    params.ano &&
      params.id &&
      params.action !== "duplicate" &&
      params.action !== "new",
  );
}

export function formToSavePayload(
  form: GerenciaFormState,
  params: GerenciaSearchParams,
  ponto: string,
  techSpec?: TechSpec,
): SaveOsPayload {
  const isEdit = isGerenciaEditMode(params);

  return {
    NroProtocolo: isEdit ? parseInt(params.id!, 10) : null,
    AnoProtocolo: isEdit ? parseInt(params.ano!, 10) : null,

    CodigoRequisicao: val("req_codigo", form) || null,
    CategoriaLink: val("req_categoria", form) || null,
    NomeUsuario: val("req_solicitante", form) || null,
    Titular: val("req_titular", form) || null,
    OrgInteressado: val("req_orgao_interessado", form) || null,
    SiglaOrgao: val("req_sigla", form) || null,
    GabSalaUsuario: val("req_gabinete", form) || null,
    Andar: val("req_andar", form) || null,
    Localizacao: val("req_local", form) || null,
    RamalUsuario: val("req_ramal", form) || null,

    DataEntrada: val("op_data_entrada", form) || null,
    ProcessoSolicit: val("op_processo", form) || null,
    CSnro: val("op_cs", form) || null,
    TiragemSolicitada: val("op_tiragem_pret", form) || null,
    TiragemFinal: val("op_tiragem_final", form) || null,

    Titulo: val("val_titulo", form) || null,
    TipoPublicacaoLink: val("val_produto", form) || null,
    FormatoLink: val("val_formato", form) || null,
    MaquinaLink: val("val_maquina", form) || null,
    Tiragem: val("val_tiragem", form) || null,
    Pags: val("val_pgs", form) || null,
    FrenteVerso: chk("chk_fv", form),
    ModelosArq: val("val_modelos", form) || null,

    EntregPrazoLink: val("val_prioridade", form) || null,
    EntregData: val("val_data", form) || null,

    PapelLink: val("val_papel", form) || null,
    PapelDescricao: val("txt_papel_desc", form) || null,
    Cores: val("val_cores", form) || null,
    CoresDescricao: val("txt_cores_desc", form) || null,

    DescAcabamento: val("txt_acabamento", form) || null,
    Observ: val("txt_obs", form) || null,
    ContatoTrab: val("txt_contato", form) || null,

    MaterialFornecido: chk("mat_amostra", form),
    Fotolito: chk("mat_fotolito", form),
    ModeloDobra: chk("mat_dobra", form),
    ProvaImpressa: chk("mat_original", form),
    InsumosFornecidos: val("mat_insumos", form) || null,

    ElemGrafBrasao: chk("el_brasao", form),
    ElemGrafTimbre: chk("el_timbre", form),
    ElemGrafArteGab: chk("el_arte", form),
    ElemGrafAssinatura: chk("el_assinatura", form),

    DebitarCGRAF: chk("chk_debitar_cgraf", form),

    Calculos: {
      capa_color: num("calc_capa_color", form),
      capa_pb: num("calc_capa_pb", form),
      miolo_color: num("calc_miolo_color", form),
      miolo_pb: num("calc_miolo_pb", form),
      encarte_color: num("calc_encarte_color", form),
      encarte_pb: num("calc_encarte_pb", form),
      altura_mm: num("calc_altura", form),
      largura_mm: num("calc_largura", form),
      tiragem: num("calc_tiragem", form),
      coef_a4: parseCoefA4Value(val("calc_coef_a4", form)),
      total_paginas: num("calc_total_paginas", form),
      cota_total: parseCotaEstimadaValue(val("calc_cota_total", form)),
    },

    TechSpec: techSpec ?? { version: 1, componentes: [] },

    PontoUsuario: ponto,
  };
}
