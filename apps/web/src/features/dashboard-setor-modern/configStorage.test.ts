import { beforeEach, describe, expect, it } from "vitest";

import {
  DASHBOARD_CONFIG_STORAGE_KEY,
  DEFAULT_DASHBOARD_CONFIG,
} from "@/features/dashboard-setor/constants";
import { writeLocalPreferencePayload } from "@/lib/userPreferences";
import {
  loadModernDashboardConfig,
  MODERN_CONFIG_KEY,
  saveModernDashboardConfig,
} from "./configStorage";

describe("configuração independente do painel moderno", () => {
  beforeEach(() => localStorage.clear());

  it("copia a configuração existente e salva somente na nova chave", () => {
    const original = { ...DEFAULT_DASHBOARD_CONFIG, sector: "SEIMP" };
    localStorage.setItem(
      DASHBOARD_CONFIG_STORAGE_KEY,
      JSON.stringify(original),
    );
    expect(loadModernDashboardConfig("SEFOC")).toEqual(original);
    saveModernDashboardConfig({ ...original, sector: "SEPAC" });
    expect(loadModernDashboardConfig().sector).toBe("SEPAC");
    expect(
      JSON.parse(localStorage.getItem(DASHBOARD_CONFIG_STORAGE_KEY)!),
    ).toEqual(original);
  });

  it("sincronização remota escreve apenas a preferência do painel novo", () => {
    const original = JSON.stringify(DEFAULT_DASHBOARD_CONFIG);
    localStorage.setItem(DASHBOARD_CONFIG_STORAGE_KEY, original);
    writeLocalPreferencePayload("painel_setor_moderno", {
      ...DEFAULT_DASHBOARD_CONFIG,
      sector: "SEPAC",
    });
    expect(localStorage.getItem(DASHBOARD_CONFIG_STORAGE_KEY)).toBe(original);
    expect(JSON.parse(localStorage.getItem(MODERN_CONFIG_KEY)!).sector).toBe(
      "SEPAC",
    );
  });

  it("mantém oculta a escolha de não exibir o tempo da OS", () => {
    saveModernDashboardConfig({
      ...DEFAULT_DASHBOARD_CONFIG,
      showAndamentoTime: false,
    });
    expect(loadModernDashboardConfig().showAndamentoTime).toBe(false);
  });

  it("recupera um cache inválido e usa o setor do usuário no padrão", () => {
    localStorage.setItem(MODERN_CONFIG_KEY, "{inválido");
    expect(loadModernDashboardConfig("SEIMP").sector).toBe("SEIMP");
  });
});
