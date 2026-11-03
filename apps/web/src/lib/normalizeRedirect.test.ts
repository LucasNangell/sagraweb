import { describe, expect, it } from "vitest";

import { normalizeAppRedirect } from "@/lib/normalizeRedirect";

describe("normalizeAppRedirect", () => {
  it("converte /sagra e /sagra/ para a home", () => {
    expect(normalizeAppRedirect("/sagra")).toBe("/");
    expect(normalizeAppRedirect("/sagra/")).toBe("/");
  });

  it("remove o prefixo /sagra de rotas internas", () => {
    expect(normalizeAppRedirect("/sagra/email")).toBe("/email");
    expect(normalizeAppRedirect("/sagra/painel/setor")).toBe("/painel/setor");
  });

  it("mantém rotas internas sem o prefixo de deploy", () => {
    expect(normalizeAppRedirect("/email")).toBe("/email");
    expect(normalizeAppRedirect("/")).toBe("/");
  });

  it("ignora valor vazio", () => {
    expect(normalizeAppRedirect(undefined)).toBeUndefined();
    expect(normalizeAppRedirect("")).toBeUndefined();
    expect(normalizeAppRedirect("   ")).toBeUndefined();
  });
});
