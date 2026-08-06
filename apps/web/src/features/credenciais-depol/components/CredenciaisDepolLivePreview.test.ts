import { describe, expect, it } from "vitest";

import {
  boxToCssPercent,
  countLinhasPreenchidas,
  linhasToTexto,
  pickSvgBox,
  svgFileForLinhas,
  textoToLinhas,
} from "./CredenciaisDepolLivePreview";

describe("countLinhasPreenchidas / svgFileForLinhas", () => {
  it("escolhe TXT01/02/03 conforme linhas preenchidas", () => {
    expect(countLinhasPreenchidas({ linha1: "", linha2: "", linha3: "" })).toBe(0);
    expect(countLinhasPreenchidas({ linha1: "A", linha2: "", linha3: "" })).toBe(1);
    expect(countLinhasPreenchidas({ linha1: "A", linha2: "B", linha3: "" })).toBe(2);
    expect(countLinhasPreenchidas({ linha1: "A", linha2: "B", linha3: "C" })).toBe(3);
    expect(svgFileForLinhas(1)).toBe("TXT01.svg");
    expect(svgFileForLinhas(2)).toBe("TXT02.svg");
    expect(svgFileForLinhas(3)).toBe("TXT03.svg");
  });
});

describe("boxToCssPercent", () => {
  it("converte centro Corel (CenterX/Y) para top/left CSS", () => {
    const css = boxToCssPercent(
      { x_mm: 42.5, y_mm: 101, w_mm: 39, h_mm: 14 },
      85,
      120,
    );
    expect(css.left).toBeCloseTo(((42.5 - 19.5) / 85) * 100);
    expect(css.width).toBeCloseTo((39 / 85) * 100);
    expect(css.height).toBeCloseTo((14 / 120) * 100);
    expect(css.top).toBeCloseTo(((120 - (101 + 7)) / 120) * 100);
  });
});

describe("pickSvgBox", () => {
  it("aceita x/y zero sem cair no default", () => {
    const box = pickSvgBox(
      {
        page_w_mm: 85,
        page_h_mm: 120,
        svgs: {
          "1": { x_mm: 0, y_mm: 0, w_mm: 10, h_mm: 10 },
          "2": { x_mm: 1, y_mm: 2, w_mm: 3, h_mm: 4 },
          "3": { x_mm: 1, y_mm: 2, w_mm: 3, h_mm: 4 },
        },
      },
      1,
    );
    expect(box.x_mm).toBe(0);
    expect(box.y_mm).toBe(0);
  });
});

describe("textoToLinhas / linhasToTexto", () => {
  it("divide por Enter até 3 linhas", () => {
    const p = textoToLinhas("A\nB\nC");
    expect(p).toEqual({
      linha1: "A",
      linha2: "B",
      linha3: "C",
      extraLines: 0,
    });
    expect(linhasToTexto(p)).toBe("A\nB\nC");
  });

  it("detecta linhas extras", () => {
    expect(textoToLinhas("1\n2\n3\n4").extraLines).toBe(1);
  });
});
