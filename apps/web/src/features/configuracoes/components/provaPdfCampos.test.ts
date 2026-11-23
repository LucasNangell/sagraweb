import { describe, expect, it } from "vitest";

import type { ProvaPdfModelo, ProvaPdfTexto } from "@/api/papelariaProvaPdf";

import {
  casarCampoComTexto,
  chaveTexto,
  hidratarCampos,
  variaveisDosTemplates,
} from "./provaPdfCampos";

function texto(marcador: string, pagina = 1): ProvaPdfTexto {
  return {
    marcador,
    pagina,
    fonte: "Arial",
    tamanho: 10,
    cor: "0 g",
    x_mm: 1,
    y_mm: 1,
    alinhamento_sugerido: "esquerda",
    ancora_sugerida: "topo",
  };
}

function modelo(partial: Partial<ProvaPdfModelo>): ProvaPdfModelo {
  return {
    tem_pdf: true,
    campos: [],
    analise: { paginas: [], fontes: [], textos: [] },
    ...partial,
  };
}

describe("hidratarCampos", () => {
  it("sobrepõe template salvo na linha da análise", () => {
    const data = modelo({
      campos: [
        {
          marcador: "NOME",
          pagina: 1,
          template: "{nome_deputado}",
          alinhamento: "centro",
          ancora: "auto",
          entrelinha: 1.2,
          reduzir_para_caber: true,
        },
      ],
      analise: {
        paginas: [],
        fontes: [],
        textos: [texto("NOME"), texto("FIXO")],
      },
    });
    const { mapa, orfaos } = hidratarCampos(data);
    expect(mapa[chaveTexto(texto("NOME"))].template).toBe("{nome_deputado}");
    expect(mapa[chaveTexto(texto("NOME"))].alinhamento).toBe("centro");
    expect(mapa[chaveTexto(texto("NOME"))].uppercase).toBe(false);
    expect(mapa[chaveTexto(texto("FIXO"))].template).toBe("");
    expect(orfaos).toHaveLength(0);
  });

  it("preserva uppercase e bloquear_edicao salvos no campo", () => {
    const data = modelo({
      campos: [
        {
          marcador: "NOME",
          pagina: 1,
          template: "{nome_deputado}",
          alinhamento: "auto",
          ancora: "auto",
          entrelinha: 1.2,
          reduzir_para_caber: true,
          uppercase: true,
          bloquear_edicao: true,
        },
      ],
      analise: {
        paginas: [],
        fontes: [],
        textos: [texto("NOME")],
      },
    });
    const { mapa } = hidratarCampos(data);
    expect(mapa[chaveTexto(texto("NOME"))].uppercase).toBe(true);
    expect(mapa[chaveTexto(texto("NOME"))].bloquear_edicao).toBe(true);
  });

  it("casa pagina 0 com o primeiro texto do marcador", () => {
    const match = casarCampoComTexto(
      {
        marcador: "NOME",
        pagina: 0,
        template: "{x}",
        alinhamento: "auto",
        ancora: "auto",
        entrelinha: 1.2,
        reduzir_para_caber: true,
      },
      [texto("NOME", 2)],
    );
    expect(match?.pagina).toBe(2);
  });

  it("mantém órfão editável quando marcador sumiu da análise", () => {
    const data = modelo({
      campos: [
        {
          marcador: "ANTIGO",
          pagina: 1,
          template: "{partido}",
          alinhamento: "auto",
          ancora: "auto",
          entrelinha: 1.2,
          reduzir_para_caber: true,
        },
      ],
      analise: {
        paginas: [],
        fontes: [],
        textos: [texto("NOVO")],
      },
    });
    const { mapa, orfaos } = hidratarCampos(data);
    expect(orfaos).toHaveLength(1);
    expect(orfaos[0].marcador).toBe("ANTIGO");
    expect(mapa["1|ANTIGO"].template).toBe("{partido}");
    expect(mapa[chaveTexto(texto("NOVO"))].template).toBe("");
  });
});

describe("variaveisDosTemplates", () => {
  it("extrai chaves únicas", () => {
    expect(
      variaveisDosTemplates([
        {
          marcador: "a",
          pagina: 1,
          template: "{nome}\n{email}",
          alinhamento: "auto",
          ancora: "auto",
          entrelinha: 1.2,
          reduzir_para_caber: true,
        },
        {
          marcador: "b",
          pagina: 1,
          template: "{nome}",
          alinhamento: "auto",
          ancora: "auto",
          entrelinha: 1.2,
          reduzir_para_caber: true,
        },
      ]),
    ).toEqual(["nome", "email"]);
  });
});
