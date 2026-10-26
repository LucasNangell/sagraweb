import { describe, expect, it } from "vitest";

import {
  getPainelOsInstallVariant,
  isPainelOsInstallContext,
} from "@/components/pwa/usePainelOsManifest";

describe("isPainelOsInstallContext", () => {
  it("detecta /painel/tablet", () => {
    expect(isPainelOsInstallContext("/painel/tablet")).toBe(true);
    expect(isPainelOsInstallContext("/painel/tablet/")).toBe(true);
  });

  it("detecta /painel/celular", () => {
    expect(isPainelOsInstallContext("/painel/celular")).toBe(true);
    expect(isPainelOsInstallContext("/painel/celular/")).toBe(true);
  });

  it("detecta /painel/gravacao", () => {
    expect(isPainelOsInstallContext("/painel/gravacao")).toBe(true);
    expect(isPainelOsInstallContext("/painel/gravacao/")).toBe(true);
  });

  it("detecta /painel/setor-moderno", () => {
    expect(isPainelOsInstallContext("/painel/setor-moderno")).toBe(true);
    expect(isPainelOsInstallContext("/painel/setor-moderno/")).toBe(true);
  });

  it("detecta login com redirect para o tablet", () => {
    expect(isPainelOsInstallContext("/login", "/painel/tablet")).toBe(true);
    expect(isPainelOsInstallContext("/login/", "/painel/tablet")).toBe(true);
  });

  it("detecta login com redirect para o celular", () => {
    expect(isPainelOsInstallContext("/login", "/painel/celular")).toBe(true);
  });

  it("detecta login com redirect para o painel de gravação", () => {
    expect(isPainelOsInstallContext("/login", "/painel/gravacao")).toBe(true);
  });

  it("detecta login com redirect para o painel setor moderno", () => {
    expect(isPainelOsInstallContext("/login", "/painel/setor-moderno")).toBe(
      true,
    );
  });

  it("ignora outras rotas", () => {
    expect(isPainelOsInstallContext("/")).toBe(false);
    expect(isPainelOsInstallContext("/login")).toBe(false);
    expect(isPainelOsInstallContext("/login", "/home")).toBe(false);
    expect(isPainelOsInstallContext("/painel/setor")).toBe(false);
  });
});

describe("getPainelOsInstallVariant", () => {
  it("usa o manifesto do tablet no board de OS", () => {
    expect(getPainelOsInstallVariant("/painel/tablet")).toBe("tablet");
    expect(getPainelOsInstallVariant("/painel/celular")).toBe("tablet");
    expect(getPainelOsInstallVariant("/painel/gravacao")).toBe("tablet");
    expect(getPainelOsInstallVariant("/login", "/painel/tablet")).toBe("tablet");
  });

  it("usa o manifesto do setor moderno na rota correspondente", () => {
    expect(getPainelOsInstallVariant("/painel/setor-moderno")).toBe(
      "setor-moderno",
    );
    expect(getPainelOsInstallVariant("/login", "/painel/setor-moderno")).toBe(
      "setor-moderno",
    );
  });

  it("não aplica manifesto de painel no setor clássico", () => {
    expect(getPainelOsInstallVariant("/painel/setor")).toBeNull();
  });
});
