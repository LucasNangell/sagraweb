import { describe, expect, it } from "vitest";



import { isPainelOsInstallContext } from "@/components/pwa/usePainelOsManifest";



describe("isPainelOsInstallContext", () => {

  it("detecta /painel/tablet", () => {

    expect(isPainelOsInstallContext("/painel/tablet")).toBe(true);

    expect(isPainelOsInstallContext("/painel/tablet/")).toBe(true);

  });



  it("detecta /painel/celular", () => {

    expect(isPainelOsInstallContext("/painel/celular")).toBe(true);

    expect(isPainelOsInstallContext("/painel/celular/")).toBe(true);

  });



  it("detecta login com redirect para o tablet", () => {

    expect(isPainelOsInstallContext("/login", "/painel/tablet")).toBe(true);

    expect(isPainelOsInstallContext("/login/", "/painel/tablet")).toBe(true);

  });



  it("detecta login com redirect para o celular", () => {

    expect(isPainelOsInstallContext("/login", "/painel/celular")).toBe(true);

  });



  it("ignora outras rotas", () => {

    expect(isPainelOsInstallContext("/")).toBe(false);

    expect(isPainelOsInstallContext("/login")).toBe(false);

    expect(isPainelOsInstallContext("/login", "/home")).toBe(false);

    expect(isPainelOsInstallContext("/painel/setor")).toBe(false);

  });

});

