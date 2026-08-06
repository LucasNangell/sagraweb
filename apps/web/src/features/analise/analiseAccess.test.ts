import { describe, expect, it } from "vitest";

import {
  analiseButtonCaption,
  canEditAnalisePreview,
  canPromptStartAnalise,
  cleanPonto,
  hasProblemasTecnicosAndamento,
  isSefocSetor,
  resolveAnaliseButtonMode,
} from "./analiseAccess";

describe("analiseAccess", () => {
  it("cleanPonto strips non-digits", () => {
    expect(cleanPonto("P-123")).toBe("123");
    expect(cleanPonto(45)).toBe("45");
  });

  it("isSefocSetor is case-insensitive", () => {
    expect(isSefocSetor("sefoc")).toBe(true);
    expect(isSefocSetor("Arte")).toBe(false);
  });

  it("canPromptStartAnalise matches start situations", () => {
    expect(canPromptStartAnalise("Em Execução")).toBe(true);
    expect(canPromptStartAnalise("Saída p/ SEFOC")).toBe(true);
    expect(canPromptStartAnalise("Recebido")).toBe(false);
  });

  it("canEditAnalisePreview requires SEFOC for edit", () => {
    expect(
      canEditAnalisePreview({
        userSetor: "Arte",
        situacao: "Problemas Técnicos",
        lastPonto: "1",
        currentPonto: "1",
      }),
    ).toBe(false);
    expect(
      canEditAnalisePreview({
        userSetor: "SEFOC",
        situacao: "Problemas Técnicos",
        lastPonto: "1",
        currentPonto: "1",
      }),
    ).toBe(true);
  });

  it("canEditAnalisePreview checks Recebido ponto match", () => {
    expect(
      canEditAnalisePreview({
        userSetor: "SEFOC",
        situacao: "Recebido",
        lastPonto: "10",
        currentPonto: "10",
      }),
    ).toBe(true);
    expect(
      canEditAnalisePreview({
        userSetor: "SEFOC",
        situacao: "Recebido",
        lastPonto: "10",
        currentPonto: "99",
      }),
    ).toBe(false);
  });

  it("hasProblemasTecnicosAndamento", () => {
    expect(hasProblemasTecnicosAndamento([])).toBe(false);
    expect(
      hasProblemasTecnicosAndamento([{ SituacaoLink: "Recebido" }]),
    ).toBe(false);
    expect(
      hasProblemasTecnicosAndamento([
        { SituacaoLink: "Recebido" },
        { SituacaoLink: "Problemas Técnicos" },
      ]),
    ).toBe(true);
  });

  it("resolveAnaliseButtonMode", () => {
    expect(
      resolveAnaliseButtonMode({
        canEdit: true,
        hasProblemasTecnicos: false,
        currentSituacao: "Problemas Técnicos",
      }),
    ).toBe("revisar");
    expect(
      resolveAnaliseButtonMode({ canEdit: true, hasProblemasTecnicos: false }),
    ).toBe("fazer");
    expect(
      resolveAnaliseButtonMode({ canEdit: false, hasProblemasTecnicos: true }),
    ).toBe("ver");
    expect(
      resolveAnaliseButtonMode({ canEdit: false, hasProblemasTecnicos: false }),
    ).toBeNull();
  });

  it("analiseButtonCaption", () => {
    expect(analiseButtonCaption("fazer")).toBe("Fazer análise");
    expect(analiseButtonCaption("revisar")).toBe("Revisar análise");
    expect(analiseButtonCaption("ver")).toBe("Ver problemas");
  });
});
