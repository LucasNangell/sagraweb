import { describe, expect, it } from "vitest";

import {
  formatRecebimentoChapasConfirmText,
  formatRecebimentoChapasObsPreview,
  isRecebimentoChapasTabletCard,
} from "./recebimentoChapas";

describe("isRecebimentoChapasTabletCard", () => {
  it("reconhece Aguard. Retirada em SEFOC", () => {
    expect(
      isRecebimentoChapasTabletCard({
        situacao: "Aguard. Retirada",
        setor: "SEFOC",
      }),
    ).toBe(true);
  });

  it("ignora outros setores ou situações", () => {
    expect(
      isRecebimentoChapasTabletCard({
        situacao: "Aguard. Retirada",
        setor: "SEPAC",
      }),
    ).toBe(false);
    expect(
      isRecebimentoChapasTabletCard({
        situacao: "Gravação",
        setor: "SEFOC",
      }),
    ).toBe(false);
    expect(isRecebimentoChapasTabletCard({})).toBe(false);
  });
});

describe("formatadores de recebimento de chapas", () => {
  const chapas = [
    { maquina: "Heidelberg", quantidade: 4 },
    { maquina: "Kodak", quantidade: 2 },
  ];

  it("monta texto de confirmação", () => {
    expect(formatRecebimentoChapasConfirmText(chapas)).toBe(
      [
        "Confirma o recebimento de:",
        "",
        "Chapas por máquina:",
        "- Heidelberg: 4",
        "- Kodak: 2",
      ].join("\n"),
    );
  });

  it("monta preview da observação igual ao backend", () => {
    expect(formatRecebimentoChapasObsPreview(chapas)).toBe(
      [
        "Entrega de chapas.",
        "",
        "Chapas por máquina:",
        "- Heidelberg: 4",
        "- Kodak: 2",
      ].join("\n"),
    );
  });

  it("usa placeholder quando não há chapas", () => {
    expect(formatRecebimentoChapasConfirmText([])).toContain(
      "- (não informado)",
    );
    expect(formatRecebimentoChapasObsPreview([])).toContain(
      "- (não informado)",
    );
  });
});
