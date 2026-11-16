import { describe, expect, it } from "vitest";

import { resolvePapelariaProvaDisplay } from "./papelariaProvaDisplay";
import type { PapelariaJob } from "./types";

function job(partial: Partial<PapelariaJob>): PapelariaJob {
  return {
    id: 10,
    nro_protocolo: 5954,
    ano_protocolo: 2026,
    tipo_job: "create",
    produto: "Ct",
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

describe("resolvePapelariaProvaDisplay", () => {
  it("usa ProvaN quando job ainda aponta BaseSefoc", () => {
    const out = resolvePapelariaProvaDisplay(
      job({
        arquivo_pdf: "05954-Nome-BaseSefoc.pdf",
        tem_arquivo_pdf: true,
        versao: 2,
        dados: {
          prova_web_pdf_name: "05954-Nome-Prova2.pdf",
          prova_numero: 2,
        },
      }),
    );
    expect(out?.fileLabel).toBe("05954-Nome-Prova2.pdf");
    expect(out?.provaLabel).toBe("Prova 2");
    expect(out?.versao).toBe(2);
    expect(out?.pdfUrl).toContain("05954-Nome-Prova2.pdf");
  });

  it("usa arquivo do job quando já é ProvaN", () => {
    const out = resolvePapelariaProvaDisplay(
      job({
        arquivo_pdf: "05954-Nome-Prova3.pdf",
        tem_arquivo_pdf: true,
        versao: 3,
      }),
    );
    expect(out?.fileLabel).toBe("05954-Nome-Prova3.pdf");
    expect(out?.provaLabel).toBe("Prova 3");
    expect(out?.pdfUrl).toContain("/papelaria/jobs/10/arquivo/pdf");
  });
});
