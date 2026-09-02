import { describe, expect, it } from "vitest";

import {
  formatAndamentoObsHoraStamp,
  insertAndamentoObsHoraStamp,
} from "./andamentoObsHoraStamp";

describe("formatAndamentoObsHoraStamp", () => {
  it("formata data, hora e nome no padrão do carimbo", () => {
    expect(
      formatAndamentoObsHoraStamp(
        new Date(2026, 8, 1, 20, 10),
        "João Lucas",
      ),
    ).toBe("01/Set/26 20h10 - João Lucas");
  });

  it("usa abreviações de mês sem ponto e distingue Mar de Mai", () => {
    expect(
      formatAndamentoObsHoraStamp(new Date(2026, 2, 5, 9, 5), "Ana"),
    ).toBe("05/Mar/26 09h05 - Ana");
    expect(
      formatAndamentoObsHoraStamp(new Date(2026, 4, 5, 9, 5), "Ana"),
    ).toBe("05/Mai/26 09h05 - Ana");
  });
});

describe("insertAndamentoObsHoraStamp", () => {
  const stamp = "01/Set/26 20h10 - João Lucas";

  it("com observação vazia, quebra para a linha de baixo", () => {
    const result = insertAndamentoObsHoraStamp("", stamp);
    expect(result.text).toBe(`${stamp}\n`);
    expect(result.cursor).toBe(`${stamp}\n`.length);
  });

  it("com texto original, acrescenta após ele com uma linha em branco", () => {
    const result = insertAndamentoObsHoraStamp("texto original", stamp);
    expect(result.text).toBe(`texto original\n\n${stamp}\n`);
    expect(result.cursor).toBe(result.text.length);
  });

  it("empilha um segundo carimbo no final", () => {
    const first = insertAndamentoObsHoraStamp("texto original", stamp);
    const secondStamp = "01/Set/26 20h11 - João Lucas";
    const second = insertAndamentoObsHoraStamp(first.text, secondStamp);
    expect(second.text).toBe(
      `texto original\n\n${stamp}\n\n${secondStamp}\n`,
    );
    expect(second.cursor).toBe(second.text.length);
  });
});
