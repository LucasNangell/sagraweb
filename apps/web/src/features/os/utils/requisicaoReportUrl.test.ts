import { describe, expect, it } from "vitest";
import { fichaOsTitle } from "./requisicaoReportUrl";

describe("fichaOsTitle", () => {
  it("usa o título de OS para números abaixo de 5000", () => {
    expect(fichaOsTitle(123)).toBe("Ficha da Ordem de Serviço");
    expect(fichaOsTitle(4999, "normal")).toBe("Ficha da Ordem de Serviço");
  });

  it("usa o título de papelaria para números >= 5000", () => {
    expect(fichaOsTitle(5000)).toBe("Ficha do Serviço de Papelaria");
    expect(fichaOsTitle(5123)).toBe("Ficha do Serviço de Papelaria");
  });

  it("mantém títulos de prova mesmo em papelaria", () => {
    expect(fichaOsTitle(5123, "prova")).toBe("Ficha p/ Tramitação de Prévia");
    expect(fichaOsTitle(5123, "prova_ficha")).toBe(
      "Ficha p/ Tramitação de Prova",
    );
  });
});
