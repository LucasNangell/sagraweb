import { describe, expect, it } from "vitest";

import { aplicarVariaveisFonte, fontesDoEnriquecimento } from "./deputadoCorelPrefill";

describe("variáveis com fonte no enriquecimento da Câmara", () => {
  const enrich = { nome_deputado: "Maria Silva", genero: "Deputada", partido: "PT", uf: "df", gabinete: "123", anexo: "IV" };

  it("calcula as fontes do deputado e do gabinete", () => {
    const f = fontesDoEnriquecimento(enrich);
    expect(f["deputado_genero_federal"]).toBe("Deputada Federal");
    expect(f["deputado_partido_uf"]).toBe("PT/DF");
    expect(f["gabinete_endereco"]).toBe("Anexo IV, Gabinete 123");
  });

  it("preenche as variáveis do cadastro pela fonte", () => {
    const out = aplicarVariaveisFonte(enrich, { cargo: "deputado_genero_federal", nome_cartao: "deputado_nome" });
    expect(out["cargo"]).toBe("Deputada Federal");
    expect(out["nome_cartao"]).toBe("Maria Silva");
    expect(out["partido"]).toBe("PT");
    expect(aplicarVariaveisFonte(enrich, undefined)).toBe(enrich);
  });
});
