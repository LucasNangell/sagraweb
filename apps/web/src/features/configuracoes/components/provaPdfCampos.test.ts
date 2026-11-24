import { describe, expect, it } from "vitest";

import type { ProvaPdfModelo, ProvaPdfTexto } from "@/api/papelariaProvaPdf";

import {
  campoVazio,
  casarCampoComTexto,
  chaveTexto,
  entrelinhaEntre,
  hidratarCampos,
  juntadosPorDono,
  juntarCampos,
  textoAbaixo,
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

describe("juntar textos num campo só (rodapé)", () => {
  const texto = (marcador: string, y_mm: number): ProvaPdfTexto => ({
    marcador,
    pagina: 1,
    fonte: "Stone",
    tamanho: 8,
    cor: "#000",
    x_mm: 50,
    y_mm,
    alinhamento_sugerido: "centro",
    ancora_sugerida: "base",
  });
  const l1 = texto("Câmara dos Deputados | Anexo IV", 285.4);
  const l2 = texto("Tels (61) 3215-5000", 289.1);
  const longe = texto("Cabeçalho", 20);

  it("acha a linha logo abaixo e calcula a entrelinha do modelo", () => {
    expect(textoAbaixo(l1, [l1, l2, longe])).toBe(l2);
    expect(textoAbaixo(l2, [l1, l2, longe])).toBeNull();
    expect(entrelinhaEntre(l1, l2)).toBeCloseTo(1.31, 1);
  });

  it("junta template e textos; a linha de baixo deixa de ser campo", () => {
    const dono = { ...campoVazio(l1), template: "Câmara | Gabinete {gabinete}" };
    const baixo = { ...campoVazio(l2), template: "Tels {telefone}" };
    const r = juntarCampos(dono, l1, l2, baixo);
    expect(r.template).toBe("Câmara | Gabinete {gabinete}\nTels {telefone}");
    expect(r.juntar).toEqual([l2.marcador]);
    expect(r.entrelinha).toBeCloseTo(1.31, 1);
    const mapa = { [chaveTexto(l1)]: r, [chaveTexto(l2)]: campoVazio(l2) };
    expect(juntadosPorDono(mapa).get(chaveTexto(l2))).toBe(chaveTexto(l1));
  });

  it("sem template usa o próprio texto do PDF", () => {
    const r = juntarCampos(campoVazio(l1), l1, l2, undefined);
    expect(r.template).toBe(`${l1.marcador}\n${l2.marcador}`);
  });
});
