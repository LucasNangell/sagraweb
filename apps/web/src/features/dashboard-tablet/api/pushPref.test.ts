import { describe, expect, it } from "vitest";

/** Espelha o título do push no backend (OS nro/aa). */
function formatOsPushTitle(nro: number, ano: number): string {
  return `OS ${nro}/${String(ano % 100).padStart(2, "0")}`;
}

describe("painel tablet push title", () => {
  it("formata OS/ano curto como o backend", () => {
    expect(formatOsPushTitle(427, 2026)).toBe("OS 427/26");
    expect(formatOsPushTitle(12, 2000)).toBe("OS 12/00");
  });
});
