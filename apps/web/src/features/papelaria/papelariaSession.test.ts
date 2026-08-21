import { describe, expect, it } from "vitest";

import { validateRequiredFields } from "./components/PapelariaCorelPanel";
import {
  isPapelariaCorelOs,
  isPapelariaProduct,
  isTimbradoA4DigitalProduct,
  resolveInitialPapelariaTab,
  type PapelariaSessionContext,
} from "./papelariaSession";

describe("resolveInitialPapelariaTab", () => {
  it("abre Corel para OS >= 5000", () => {
    const session: PapelariaSessionContext = {
      osId: "5024",
      osAno: "2025",
      targetProduct: "Ct Visita",
    };
    expect(resolveInitialPapelariaTab(session)).toBe("corel");
    expect(isPapelariaCorelOs("5024")).toBe(true);
  });

  it("mantém SVG sem OS vinculada", () => {
    const session: PapelariaSessionContext = {
      osId: null,
      osAno: null,
      targetProduct: null,
    };
    expect(resolveInitialPapelariaTab(session)).toBe("cartao");
  });

  it("mantém SVG para OS < 5000 se não for produto de papelaria", () => {
    const session: PapelariaSessionContext = {
      osId: "1234",
      osAno: "2025",
      targetProduct: null,
    };
    expect(resolveInitialPapelariaTab(session)).toBe("cartao");
    expect(isPapelariaCorelOs("1234")).toBe(false);
  });

  it("abre Corel para OS < 5000 se o produto for papelaria", () => {
    const session: PapelariaSessionContext = {
      osId: "1234",
      osAno: "2025",
      targetProduct: "Ct Visita",
    };
    expect(resolveInitialPapelariaTab(session)).toBe("corel");
    expect(isPapelariaCorelOs("1234")).toBe(false);
    expect(isPapelariaProduct("Ct Visita")).toBe(true);
    expect(isPapelariaProduct("Folder")).toBe(false);
  });
});

describe("isTimbradoA4DigitalProduct", () => {
  it("reconhece apenas Timbrado A4 (Digital)", () => {
    expect(isTimbradoA4DigitalProduct("Timbrado A4 (Digital)")).toBe(true);
    expect(isTimbradoA4DigitalProduct("timbrado a4 (digital)")).toBe(true);
    expect(isTimbradoA4DigitalProduct("Timbrado A4")).toBe(false);
    expect(isTimbradoA4DigitalProduct("Bloco A5")).toBe(false);
    expect(isTimbradoA4DigitalProduct(null)).toBe(false);
  });
});

describe("validateRequiredFields", () => {
  it("exige campos obrigatórios normais", () => {
    const fields = [
      { key: "campo1", label: "Campo 1", required: true, type: "text" },
      { key: "campo2", label: "Campo 2", required: true, type: "text" },
    ];
    const values = { campo1: "Valor 1" };
    expect(validateRequiredFields(fields, values)).toEqual(["Campo 2"]);
  });

  it("ignora campos obrigatórios se estiverem na lista de excluídos", () => {
    const fields = [
      { key: "campo1", label: "Campo 1", required: true, type: "text" },
      { key: "campo2", label: "Campo 2", required: true, type: "text" },
    ];
    const values = { campo1: "Valor 1" };
    expect(validateRequiredFields(fields, values, ["campo2"])).toEqual([]);
  });
});
