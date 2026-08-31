import type {
  OrcamentoConsolidado,
  OrcamentoEntrada,
  OrcamentoResponse,
} from "@/features/orcamento/types";

function stubConsolidado(tecnologia: string, total: number): OrcamentoConsolidado {
  return {
    tecnologia,
    custo_papel: 10,
    custo_clique: 20,
    custo_pre: 0,
    custo_tinta: 0,
    custo_acabamento: 5,
    custo_material: 35,
    custo_direto: 35,
    custo_indiretos: 15,
    material_detalhe: [{ nome: "Papel — Couche fosco 300g", valor: 10 }],
    indiretos_detalhe: [],
    total,
    unitario: total,
    por_cento_paginas: 0,
    componentes: [],
  };
}

export function stubOrcamentoResponse(): OrcamentoResponse {
  const entrada: OrcamentoEntrada = {
    os: {
      nro_protocolo: 1365,
      ano_protocolo: 2026,
      titulo: "Marcador de livro",
      solicitante: "Gabinete",
      processo: "",
      data_entrada: "2026-01-01",
      produto: "Marcador",
      formato_os: "55x200",
      maquina: "Digital",
      papel_os: "Couché",
      cores_os: "4x0",
      acabamento_os: "",
    },
    tiragem: 100,
    tecnologia: "digital",
    componentes: [
      {
        nome: "Único",
        tipo: "UNICO",
        menor_mm: 55,
        maior_mm: 200,
        paginas: 2,
        cor: true,
        frente_verso: false,
        verso_cor: false,
        laminacao: false,
        laminacao_fv: false,
        espiral: false,
        grampo: false,
        cola: false,
        capa_pvc: false,
        verniz: 0,
        faca_cliche: 0,
      },
    ],
  };
  const digital = stubConsolidado("digital", 124.9);
  const offset = stubConsolidado("offset", 210);
  return {
    entrada,
    opcoes: { papeis: [{ codigo: "p26", especificacao: "Couché fosco 300g", preco_unitario: 0.5 }] },
    resultado: {
      tiragem: 100,
      tecnologia_solicitada: "digital",
      tecnologia_escolhida: "digital",
      mais_economica: "digital",
      digital,
      offset,
      escolhido: digital,
      total: 124.9,
      unitario: 1.249,
      alertas: [],
    },
    oficio: {
      solicitante: "Gabinete",
      titulo: "Marcador de livro",
      processo: "",
      especificacao: "Marcador 55x200",
      paginas: 2,
      tiragem: 100,
      valor_total: 124.9,
      tecnologia_label: "Digital",
      validade_dias: 180,
      prazo_entrega_dias: 7,
      clausula_validade: "Validade 180 dias",
      clausula_entrega: "Entrega em 7 dias",
      signatario: "Diretor",
      cargo: "Diretor",
      endereco: "Anexo",
      telefone: "0",
    },
  };
}
