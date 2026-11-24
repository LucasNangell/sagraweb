import { describe, expect, it } from "vitest";

import { orientacaoPorTamanho } from "./pdfOrientacao";

describe("orientacaoPorTamanho", () => {
  it("retrato quando mais alta que larga (quadrada também)", () => {
    expect(orientacaoPorTamanho(595, 842)).toBe("retrato");
    expect(orientacaoPorTamanho(100, 100)).toBe("retrato");
  });
  it("paisagem quando mais larga", () => {
    expect(orientacaoPorTamanho(255, 142)).toBe("paisagem");
  });
  it("tamanho inválido → sem orientação", () => {
    expect(orientacaoPorTamanho(0, 100)).toBeNull();
  });
});
