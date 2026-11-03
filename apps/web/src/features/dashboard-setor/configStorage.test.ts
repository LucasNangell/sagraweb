import { beforeEach, describe, expect, it } from "vitest";

import { DASHBOARD_CONFIG_STORAGE_KEY, DEFAULT_DASHBOARD_CONFIG } from "./constants";
import {
  loadDashboardConfig,
  PAINEL_OS_CONFIG_STORAGE_KEY,
  saveDashboardConfig,
} from "./configStorage";

describe("configuração unificada dos painéis OS", () => {
  beforeEach(() => localStorage.clear());

  it("migra o painel moderno antigo sem reescrever o painel global", () => {
    const original = { ...DEFAULT_DASHBOARD_CONFIG, sector: "SEIMP" };
    localStorage.setItem(
      "sagra_dashboard_setor_moderno",
      JSON.stringify(original),
    );
    localStorage.setItem(
      DASHBOARD_CONFIG_STORAGE_KEY,
      JSON.stringify({ columnCount: 3, columns: [{ title: "global" }] }),
    );
    expect(loadDashboardConfig().sector).toBe("SEIMP");
    saveDashboardConfig({ ...original, sector: "SEPAC" });
    expect(loadDashboardConfig().sector).toBe("SEPAC");
    expect(JSON.parse(localStorage.getItem(DASHBOARD_CONFIG_STORAGE_KEY)!)).toEqual(
      { columnCount: 3, columns: [{ title: "global" }] },
    );
    expect(
      JSON.parse(localStorage.getItem(PAINEL_OS_CONFIG_STORAGE_KEY)!).sector,
    ).toBe("SEPAC");
  });

  it("migra o setor clássico só quando o JSON tem setor", () => {
    localStorage.setItem(
      DASHBOARD_CONFIG_STORAGE_KEY,
      JSON.stringify({ ...DEFAULT_DASHBOARD_CONFIG, sector: "SEFOC" }),
    );
    expect(loadDashboardConfig().sector).toBe("SEFOC");
    expect(localStorage.getItem(PAINEL_OS_CONFIG_STORAGE_KEY)).toBeTruthy();
  });

  it("migra a chave antiga do tablet", () => {
    localStorage.setItem(
      "sagra_dashboard_tablet_config",
      JSON.stringify({ ...DEFAULT_DASHBOARD_CONFIG, sector: "SEPAC" }),
    );
    expect(loadDashboardConfig().sector).toBe("SEPAC");
    expect(
      JSON.parse(localStorage.getItem(PAINEL_OS_CONFIG_STORAGE_KEY)!).sector,
    ).toBe("SEPAC");
  });

  it("usa o setor do usuário no padrão", () => {
    expect(loadDashboardConfig("SEIMP").sector).toBe("SEIMP");
  });
});
