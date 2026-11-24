import { describe, expect, it } from "vitest";

import { resolverVisualizacaoInicial, situacaoSaidaPara } from "./papelariaViewMode";

describe("situacaoSaidaPara", () => {
  it("reconhece «Saída p/» como prefixo", () => {
    expect(situacaoSaidaPara("Saída p/")).toBe(true);
    expect(situacaoSaidaPara("  Saída p/ SEFOC ")).toBe(true);
    expect(situacaoSaidaPara("Aguard. Aprovação")).toBe(false);
    expect(situacaoSaidaPara(null)).toBe(false);
  });
});

describe("resolverVisualizacaoInicial", () => {
  it("«Saída p/» sem aprovação (trabalho novo ou alteração) abre a prévia, mesmo com prova antiga", () => {
    expect(resolverVisualizacaoInicial({ situacao: "Saída p/", hasProof: true, faseProva: "alteracao" })).toBe(
      "previa",
    );
    expect(resolverVisualizacaoInicial({ situacao: "Saída p/", hasProof: false, faseProva: "none" })).toBe("previa");
  });

  it("«Saída p/» com prova aprovada pelo cliente abre a prova", () => {
    expect(resolverVisualizacaoInicial({ situacao: "Saída p/", hasProof: true, faseProva: "approved" })).toBe("prova");
  });

  it("outras situações abrem a última prova; sem prova, a prévia", () => {
    expect(resolverVisualizacaoInicial({ situacao: "Aguard. Aprovação", hasProof: true })).toBe("prova");
    expect(resolverVisualizacaoInicial({ situacao: "Em Execução", hasProof: false })).toBe("previa");
    // Imposição pronta não muda a regra: outras situações → prova.
    expect(resolverVisualizacaoInicial({ situacao: "Aguard. Juntada", hasProof: true, hasImposicao: true })).toBe(
      "prova",
    );
  });

  it("trabalho em andamento abre o acompanhamento antes da regra da situação", () => {
    expect(resolverVisualizacaoInicial({ situacao: "Saída p/", jobEmAndamento: true })).toBe("prova");
    expect(resolverVisualizacaoInicial({ situacao: "Saída p/", waitingApogee: true, hasProof: true })).toBe(
      "imposicao",
    );
  });
});
