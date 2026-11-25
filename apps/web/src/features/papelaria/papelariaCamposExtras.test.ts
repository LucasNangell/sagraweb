import { describe, expect, it } from "vitest";

import {
  CAMPOS_EXTRAS_DADOS_KEY,
  camposExtrasParaDados,
  normalizarCamposExtras,
  novoIdCampoExtra,
} from "./papelariaCamposExtras";

describe("papelariaCamposExtras", () => {
  it("normaliza lista válida", () => {
    const out = normalizarCamposExtras([
      {
        id: "extra_1",
        tipo: "texto",
        ancora_chave: "7:1:NOME",
        direcao: "abaixo",
        texto: "Cargo",
      },
      {
        id: "extra_2",
        tipo: "rede",
        ancora_chave: "7:1:NOME",
        direcao: "direita",
        rede_chave: "instagram",
        rede_valor: "@ana",
      },
    ]);
    expect(out).toHaveLength(2);
    expect(out[0]?.texto).toBe("Cargo");
    expect(out[1]?.rede_chave).toBe("instagram");
  });

  it("ignora itens inválidos", () => {
    expect(normalizarCamposExtras([{ id: "x", tipo: "foo" }])).toEqual([]);
    expect(normalizarCamposExtras("{")).toEqual([]);
  });

  it("serializa para dados do job", () => {
    const json = camposExtrasParaDados([
      {
        id: "extra_1",
        tipo: "texto",
        ancora_chave: "7:1:NOME",
        direcao: "acima",
        texto: "Linha",
        rede_chave: "",
        rede_valor: "",
      },
    ]);
    expect(json).toContain("extra_1");
    expect(CAMPOS_EXTRAS_DADOS_KEY).toBe("__campos_extras");
    expect(camposExtrasParaDados([])).toBeNull();
  });

  it("gera ids únicos", () => {
    expect(novoIdCampoExtra()).not.toBe(novoIdCampoExtra());
  });
});
