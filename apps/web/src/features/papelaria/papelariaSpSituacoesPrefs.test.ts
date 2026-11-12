import { afterEach, describe, expect, it } from "vitest";

import {
  loadPapelariaSpSituacoes,
  PAPELARIA_SP_SITUACOES_KEY,
  savePapelariaSpSituacoes,
} from "./papelariaSpSituacoesPrefs";

describe("papelariaSpSituacoesPrefs", () => {
  afterEach(() => {
    localStorage.removeItem(PAPELARIA_SP_SITUACOES_KEY);
  });

  it("retorna lista vazia quando não há preferência", () => {
    expect(loadPapelariaSpSituacoes()).toEqual([]);
  });

  it("persiste e recarrega situações únicas e limpas", () => {
    savePapelariaSpSituacoes([" Em Execução ", "Recebido", "Recebido", ""]);
    expect(loadPapelariaSpSituacoes()).toEqual(["Em Execução", "Recebido"]);
    expect(localStorage.getItem(PAPELARIA_SP_SITUACOES_KEY)).toContain(
      "Em Execução",
    );
  });

  it("ignora JSON inválido no localStorage", () => {
    localStorage.setItem(PAPELARIA_SP_SITUACOES_KEY, "{broken");
    expect(loadPapelariaSpSituacoes()).toEqual([]);
  });
});
