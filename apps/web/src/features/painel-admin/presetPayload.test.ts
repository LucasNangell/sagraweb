import { describe, expect, it } from "vitest";

import { DEFAULT_DASHBOARD_CONFIG } from "@/features/dashboard-setor/constants";

import {
  applyPresetPayload,
  isLegacyCardStylePreset,
} from "./presetPayload";

describe("presetPayload", () => {
  it("reconhece preset legado só com visual dos cards", () => {
    expect(
      isLegacyCardStylePreset({
        models: { high: { effect: "v79" }, medium: { effect: "" }, normal: { effect: "" } },
        entryAnimation: "none",
      }),
    ).toBe(true);
    expect(
      isLegacyCardStylePreset({
        sector: "SEFOC",
        columns: DEFAULT_DASHBOARD_CONFIG.columns,
        cardStyle: { models: { high: { effect: "v79" } } },
      }),
    ).toBe(false);
  });

  it("aplica preset completo incluindo tema e colunas", () => {
    const next = applyPresetPayload(DEFAULT_DASHBOARD_CONFIG, {
      sector: "Papelaria",
      columns: [{ id: "a", title: "Fila", statuses: ["Recebido"] }],
      theme: { cardGap: 20, pageBg: "#010101" },
      cardStyle: {
        models: { high: { effect: "v79" }, medium: { effect: "" }, normal: { effect: "" } },
        entryAnimation: "fx-iris",
      },
    });
    expect(next.sector).toBe("Papelaria");
    expect(next.columns[0]?.title).toBe("Fila");
    expect(next.theme?.cardGap).toBe(20);
    expect(next.cardStyle?.entryAnimation).toBe("fx-iris");
  });

  it("preset legado só troca o visual e mantém colunas atuais", () => {
    const current = {
      ...DEFAULT_DASHBOARD_CONFIG,
      sector: "SEFOC",
      theme: { pageBg: "#112233" },
    };
    const next = applyPresetPayload(current, {
      models: { high: { effect: "mod-aurora" }, medium: { effect: "" }, normal: { effect: "" } },
      entryAnimation: "none",
    });
    expect(next.sector).toBe("SEFOC");
    expect(next.theme?.pageBg).toBe("#112233");
    expect(next.columns).toEqual(DEFAULT_DASHBOARD_CONFIG.columns);
    expect(next.cardStyle?.models.high.effect).toBe("mod-aurora");
  });
});
