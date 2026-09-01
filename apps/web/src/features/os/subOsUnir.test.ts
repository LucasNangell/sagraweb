import { describe, expect, it } from "vitest";

import { sharedSetorIfAllTogether } from "./subOsUnir";

describe("sharedSetorIfAllTogether", () => {
  it("retorna o setor quando todas as Sub OS ativas estão juntas", () => {
    expect(
      sharedSetorIfAllTogether([
        { setor_atual: "SEFOC" },
        { setor: "SEFOC" },
      ]),
    ).toBe("SEFOC");
  });

  it("retorna null com um só componente", () => {
    expect(sharedSetorIfAllTogether([{ setor_atual: "SEFOC" }])).toBeNull();
  });

  it("retorna null quando os setores divergem", () => {
    expect(
      sharedSetorIfAllTogether([
        { setor_atual: "SEFOC" },
        { setor_atual: "SIELT" },
      ]),
    ).toBeNull();
  });
});
