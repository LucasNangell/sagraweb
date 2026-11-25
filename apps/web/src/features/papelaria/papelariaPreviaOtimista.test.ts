import { describe, expect, it } from "vitest";

import { CAMPOS_EXTRAS_DADOS_KEY } from "./papelariaCamposExtras";
import {
  DEBOUNCE_ACTION_MS,
  DEBOUNCE_TYPING_MS,
  delayPreviaParaChave,
} from "./papelariaPreviaOtimista";
import { TEXTOS_DADOS_KEY } from "./papelariaTextosEditados";

describe("delayPreviaParaChave", () => {
  it("digitação de formulário usa debounce de tipagem", () => {
    const a = JSON.stringify({ nome_deputado: "Ana" });
    const b = JSON.stringify({ nome_deputado: "Ana M" });
    expect(delayPreviaParaChave(a, b)).toBe(DEBOUNCE_TYPING_MS);
  });

  it("mudança em __campos_extras é imediata", () => {
    const a = JSON.stringify({ nome_deputado: "Ana" });
    const b = JSON.stringify({
      nome_deputado: "Ana",
      [CAMPOS_EXTRAS_DADOS_KEY]: "[]",
    });
    expect(delayPreviaParaChave(a, b)).toBe(DEBOUNCE_ACTION_MS);
  });

  it("mudança em __textos é imediata", () => {
    const a = JSON.stringify({ nome_deputado: "Ana" });
    const b = JSON.stringify({
      nome_deputado: "Ana",
      [TEXTOS_DADOS_KEY]: '{"7:1:A":"x"}',
    });
    expect(delayPreviaParaChave(a, b)).toBe(DEBOUNCE_ACTION_MS);
  });
});
