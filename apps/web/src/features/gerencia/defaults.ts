import type { GerenciaFormState } from "./types";

export function createEmptyGerenciaForm(): GerenciaFormState {
  return {
    req_categoria: "",
    req_codigo: "",
    req_solicitante: "",
    req_orgao_interessado: "",
    req_titular: "",
    req_sigla: "",
    req_gabinete: "",
    req_andar: "",
    req_local: "",
    req_ramal: "",

    op_os: "",
    op_ano: "",
    op_data_entrada: "",
    op_processo: "",
    op_cs: "",
    op_cota_atual: "",
    op_tiragem_pret: "",
    op_tiragem_final: "",

    val_titulo: "",
    val_prioridade: "Normal",
    val_data: "",
    val_turno: "",
    val_resp_grafica: "",
    val_forma_entrega: "",

    val_produto: "",
    val_maquina: "",
    val_tiragem: "",
    val_pgs: "",
    chk_fv: false,
    val_modelos: "",
    val_formato: "",

    val_pgs_capa1: "",
    val_papel_capa1: "",
    val_cores_capa1: "",
    val_pgs_capa2: "",
    val_papel_capa2: "",
    val_cores_capa2: "",
    val_pgs_mio: "",
    val_papel_mio: "",
    val_cores_mio: "",
    val_pgs_mio2: "",
    val_papel_mio2: "",
    val_cores_mio2: "",

    val_papel: "",
    txt_papel_desc: "",
    val_cores: "",
    txt_cores_desc: "",
    txt_acabamento: "",
    txt_obs: "",
    txt_contato: "",

    mat_amostra: false,
    mat_fotolito: false,
    mat_dobra: false,
    mat_original: false,
    mat_insumos: "",

    el_brasao: false,
    el_timbre: false,
    el_arte: false,
    el_assinatura: false,

    calc_capa_color: "",
    calc_capa_pb: "",
    calc_miolo_color: "",
    calc_miolo_pb: "",
    calc_encarte_color: "",
    calc_encarte_pb: "",
    calc_total_paginas: "",
    calc_tiragem: "",
    calc_altura: "",
    calc_largura: "",
    calc_coef_a4: "",
    calc_cota_total: "",
    chk_debitar_cgraf: false,
  };
}

export function todayIsoDate(): string {
  return new Date().toISOString().split("T")[0];
}
