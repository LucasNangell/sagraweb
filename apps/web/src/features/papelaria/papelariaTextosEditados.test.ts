import { describe, expect, it } from "vitest";

import type { ProvaPdfRegiao } from "@/api/papelariaProvaPdf";

import { interpretarEdicao, manterNegrito, semNegrito, textosParaDados } from "./papelariaTextosEditados";

function regiao(over: Partial<ProvaPdfRegiao> = {}): ProvaPdfRegiao {
  return {
    chave: "7:1:NOME",
    modelo_id: 7,
    pagina: 1,
    pagina_saida: 0,
    marcador: "NOME",
    area: [0.1, 0.2, 0.5, 0.3],
    texto: "Dep. Ana/SP",
    negrito: [],
    template: "Dep. {nome_deputado}/{uf}",
    valores: { nome_deputado: "Ana", uf: "SP" },
    editado: false,
    ...over,
  };
}

const editaveis = new Set(["nome_deputado", "uf", "telefone"]);

describe("interpretarEdicao", () => {
  it("mudança numa só variável atualiza o campo do formulário", () => {
    expect(interpretarEdicao(regiao(), "Dep. Ana Maria/SP", editaveis)).toEqual({
      tipo: "variavel",
      chave: "nome_deputado",
      valor: "Ana Maria",
    });
    expect(interpretarEdicao(regiao(), "Dep. Ana/RJ", editaveis)).toEqual({
      tipo: "variavel",
      chave: "uf",
      valor: "RJ",
    });
  });

  it("mudança no texto fixo ou em mais de uma variável vira texto livre", () => {
    expect(interpretarEdicao(regiao(), "Deputada Ana/SP", editaveis)).toEqual({
      tipo: "texto",
      texto: "Deputada Ana/SP",
    });
    expect(interpretarEdicao(regiao(), "Dep. Bia/RJ", editaveis)).toEqual({ tipo: "texto", texto: "Dep. Bia/RJ" });
  });

  it("variável que não é campo do formulário não é alterada", () => {
    const r = regiao({ template: "{genero_curto} {nome_deputado}", texto: "Deputado Ana", valores: { genero_curto: "Deputado", nome_deputado: "Ana" } });
    expect(interpretarEdicao(r, "Deputada Ana", editaveis)).toEqual({ tipo: "texto", texto: "Deputada Ana" });
  });

  it("texto já editado continua como texto livre", () => {
    const r = regiao({ editado: true, template: "", valores: {}, texto: "Livre" });
    expect(interpretarEdicao(r, "Outro", editaveis)).toEqual({ tipo: "texto", texto: "Outro" });
  });

  it("variável repetida recebe o mesmo valor", () => {
    const r = regiao({ template: "{uf} - {uf}", texto: "SP - SP", valores: { uf: "SP" } });
    expect(interpretarEdicao(r, "RJ - RJ", editaveis)).toEqual({ tipo: "variavel", chave: "uf", valor: "RJ" });
    expect(interpretarEdicao(r, "RJ - SP", editaveis).tipo).toBe("texto");
  });

  it("template com negrito e quebra de linha", () => {
    const r = regiao({
      template: "**{nome_deputado}**\nFone: {telefone}",
      texto: "Ana\nFone: 1234",
      negrito: [[0, 3]],
      valores: { nome_deputado: "Ana", telefone: "1234" },
    });
    expect(interpretarEdicao(r, "Ana\nFone: 5678", editaveis)).toEqual({
      tipo: "variavel",
      chave: "telefone",
      valor: "5678",
    });
    // Texto livre mantém o negrito do trecho que continua igual.
    expect(interpretarEdicao(r, "Ana\nRamal 9", editaveis)).toEqual({ tipo: "texto", texto: "**Ana**\nRamal 9" });
  });
});

describe("auxiliares", () => {
  it("semNegrito remove pares de **", () => {
    expect(semNegrito("**A** b **c")).toBe("A b **c");
  });
  it("manterNegrito só marca trechos presentes", () => {
    expect(manterNegrito("X Y", { texto: "Ana", negrito: [[0, 3]] })).toBe("X Y");
  });
  it("textosParaDados", () => {
    expect(textosParaDados({})).toBeNull();
    expect(textosParaDados({ "1:1:A": "x" })).toBe('{"1:1:A":"x"}');
  });
});
