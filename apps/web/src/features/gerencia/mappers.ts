import type { SaveOsPayload } from "@/api/os";

import { applyTechSpecToForm, ensureGenericoComponentes, type TechSpec } from "./techSpec";
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
  const spec = ensureGenericoComponentes(
    techSpec ?? { version: 1, componentes: [] },
    form,
  );
  const derived = applyTechSpecToForm(form, spec);

  return {
    NroProtocolo: isEdit ? parseInt(params.id!, 10) : null,
    AnoProtocolo: isEdit ? parseInt(params.ano!, 10) : null,

    CodigoRequisicao: val("req_codigo", derived) || null,
    CategoriaLink: val("req_categoria", derived) || null,
    NomeUsuario: val("req_solicitante", derived) || null,
    Titular: val("req_titular", derived) || null,
    OrgInteressado: val("req_orgao_interessado", derived) || null,
    SiglaOrgao: val("req_sigla", derived) || null,
    GabSalaUsuario: val("req_gabinete", derived) || null,
    Andar: val("req_andar", derived) || null,
    Localizacao: val("req_local", derived) || null,
    RamalUsuario: val("req_ramal", derived) || null,

    DataEntrada: val("op_data_entrada", derived) || null,
    ProcessoSolicit: val("op_processo", derived) || null,
    CSnro: val("op_cs", derived) || null,
    TiragemSolicitada: val("op_tiragem_pret", derived) || null,
    TiragemFinal: val("op_tiragem_final", derived) || null,

    Titulo: val("val_titulo", derived) || null,
    TipoPublicacaoLink: val("val_produto", derived) || null,
    FormatoLink: val("val_formato", derived) || null,
    MaquinaLink: val("val_maquina", derived) || null,
    Tiragem: val("val_tiragem", derived) || null,
    Pags: val("val_pgs", derived) || null,
    FrenteVerso: chk("chk_fv", derived),
    ModelosArq: val("val_modelos", derived) || null,

    EntregPrazoLink: val("val_prioridade", derived) || null,
    EntregData: val("val_data", derived) || null,
    EntregPeriodo: val("val_turno", derived) || null,
    ResponsavelGrafLink: val("val_resp_grafica", derived) || null,
    EntregaFormaLink: val("val_forma_entrega", derived) || null,

    PapelLink: val("val_papel", derived) || null,
    PapelDescricao: val("txt_papel_desc", derived) || null,
    Cores: val("val_cores", derived) || null,
    CoresDescricao: val("txt_cores_desc", derived) || null,

    DescAcabamento: val("txt_acabamento", derived) || null,
    Observ: val("txt_obs", derived) || null,
    ContatoTrab: val("txt_contato", derived) || null,

    MaterialFornecido: chk("mat_amostra", derived),
    Fotolito: chk("mat_fotolito", derived),
    ModeloDobra: chk("mat_dobra", derived),
    ProvaImpressa: chk("mat_original", derived),
    InsumosFornecidos: val("mat_insumos", derived) || null,

    ElemGrafBrasao: chk("el_brasao", derived),
    ElemGrafTimbre: chk("el_timbre", derived),
    ElemGrafArteGab: chk("el_arte", derived),
    ElemGrafAssinatura: chk("el_assinatura", derived),

    DebitarCGRAF: chk("chk_debitar_cgraf", derived),

    Calculos: {
      capa_color: num("calc_capa_color", derived),
      capa_pb: num("calc_capa_pb", derived),
      miolo_color: num("calc_miolo_color", derived),
      miolo_pb: num("calc_miolo_pb", derived),
      encarte_color: num("calc_encarte_color", derived),
      encarte_pb: num("calc_encarte_pb", derived),
      altura_mm: num("calc_altura", derived),
      largura_mm: num("calc_largura", derived),
      tiragem: num("calc_tiragem", derived),
      coef_a4: parseCoefA4Value(val("calc_coef_a4", derived)),
      total_paginas: num("calc_total_paginas", derived),
      cota_total: parseCotaEstimadaValue(val("calc_cota_total", derived)),
    },

    TechSpec: spec,

    PontoUsuario: ponto,
  };
}
