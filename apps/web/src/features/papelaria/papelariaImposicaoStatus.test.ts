import { describe, expect, it } from "vitest";

import {
  isReadyImposicaoPdf,
  isWaitingImposicaoApogee,
} from "./papelariaImposicaoStatus";
import type { PapelariaJob } from "./types";

function job(partial: Partial<PapelariaJob>): PapelariaJob {
  return {
    id: 1,
    nro_protocolo: 6225,
    ano_protocolo: 2026,
    tipo_job: "imposicao",
    produto: "Cartão",
    modelo_id: 1,
    arquivo_modelo: "x.cdr",
    dados: {},
    status: "completed",
    prioridade: 0,
    ordem_fila: null,
    solicitado_por: "t",
    solicitado_em: null,
    iniciado_em: null,
    concluido_em: null,
    worker_id: null,
    arquivo_cdr: null,
    arquivo_pdf: null,
    erro: null,
    tentativas: 0,
    versao: 1,
    job_pai_id: null,
    tem_arquivo_pdf: false,
    tem_arquivo_cdr: false,
    ...partial,
  };
}

describe("isWaitingImposicaoApogee", () => {
  it("true quando completed sem PDF", () => {
    expect(isWaitingImposicaoApogee(job({}))).toBe(true);
  });

  it("true quando arquivo_pdf é .jdf", () => {
    expect(
      isWaitingImposicaoApogee(job({ arquivo_pdf: "x.jdf" })),
    ).toBe(true);
  });

  it("true quando dados.aguardando_apogee", () => {
    expect(
      isWaitingImposicaoApogee(
        job({
          arquivo_pdf: "Digital/x.pdf",
          tem_arquivo_pdf: true,
          dados: { aguardando_apogee: true },
        }),
      ),
    ).toBe(true);
  });

  it("false quando PDF Digital pronto", () => {
    expect(
      isWaitingImposicaoApogee(
        job({
          arquivo_pdf: "Digital/x_Digit_10Up_A4.pdf",
          tem_arquivo_pdf: true,
          dados: { aguardando_apogee: false },
        }),
      ),
    ).toBe(false);
  });

  it("false para outros tipos", () => {
    expect(isWaitingImposicaoApogee(job({ tipo_job: "create" }))).toBe(false);
  });
});

describe("isReadyImposicaoPdf", () => {
  it("true com PDF Digital", () => {
    expect(
      isReadyImposicaoPdf(
        job({
          arquivo_pdf: "Digital/x_Digit_10Up_A4.pdf",
          tem_arquivo_pdf: true,
        }),
      ),
    ).toBe(true);
  });

  it("false enquanto aguarda Apogee", () => {
    expect(isReadyImposicaoPdf(job({}))).toBe(false);
  });
});
