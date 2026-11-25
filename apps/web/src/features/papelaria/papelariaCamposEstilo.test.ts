import { describe, expect, it } from "vitest";

import {
  CAMPOS_ESTILO_DADOS_KEY,
  camposEstiloParaDados,
  normalizarCamposEstilo,
} from "./papelariaCamposEstilo";

describe("papelariaCamposEstilo", () => {
  it("serializa e normaliza estilos de campo do modelo", () => {
    const raw = camposEstiloParaDados({
      "7:1:NOME": { tamanho_pt: 14, align_h: "centro", align_v: "meio" },
    });
    expect(raw).toBeTruthy();
    expect(CAMPOS_ESTILO_DADOS_KEY).toBe("__campos_estilo");
    const mapa = normalizarCamposEstilo(raw);
    expect(mapa["7:1:NOME"]).toEqual({
      tamanho_pt: 14,
      align_h: "centro",
      align_v: "meio",
    });
  });

  it("ignora tamanho fora da faixa", () => {
    expect(normalizarCamposEstilo({ "7:1:NOME": { tamanho_pt: 200 } })).toEqual({});
  });
});
