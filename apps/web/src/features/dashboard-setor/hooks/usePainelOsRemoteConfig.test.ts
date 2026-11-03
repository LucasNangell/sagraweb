import { describe, expect, it } from "vitest";

import { DEFAULT_DASHBOARD_CONFIG } from "../constants";
import { isPainelConfigUpdateMessage } from "../painelClientId";
import { applyPainelConfigUpdate } from "./usePainelOsRemoteConfig";

describe("applyPainelConfigUpdate", () => {
  it("substitui o layout pelo payload remoto", () => {
    const next = applyPainelConfigUpdate(DEFAULT_DASHBOARD_CONFIG, {
      payload: { ...DEFAULT_DASHBOARD_CONFIG, sector: "SEIMP", columnCount: 2 },
    });
    expect(next.sector).toBe("SEIMP");
    expect(next.columnCount).toBe(DEFAULT_DASHBOARD_CONFIG.columns.length);
  });

  it("substitui as colunas do payload remoto", () => {
    const next = applyPainelConfigUpdate(DEFAULT_DASHBOARD_CONFIG, {
      payload: {
        sector: "SEFOC",
        columns: [{ id: "fila", title: "Fila", statuses: ["Recebido"] }],
      },
    });
    expect(next.columns).toEqual([
      { id: "fila", title: "Fila", statuses: ["Recebido"] },
    ]);
    expect(next.columnCount).toBe(1);
  });

  it("preserva cardStyle do payload remoto", () => {
    const next = applyPainelConfigUpdate(DEFAULT_DASHBOARD_CONFIG, {
      payload: {
        ...DEFAULT_DASHBOARD_CONFIG,
        cardStyle: {
          models: { high: "v79-red", medium: "v80-amber", normal: "v37-amber" },
          entryAnimation: "fx-iris",
        },
      },
    });
    expect(next.cardStyle?.models.high.effect).toBe("v79");
    expect(next.cardStyle?.models.medium.effect).toBe("v80");
    expect(next.cardStyle?.models.normal.effect).toBe("v37");
    expect(next.cardStyle?.entryAnimation).toBe("fx-iris");
  });

  it("aplica só o setor quando não há payload", () => {
    const next = applyPainelConfigUpdate(DEFAULT_DASHBOARD_CONFIG, {
      sector: "SEPAC",
    });
    expect(next.sector).toBe("SEPAC");
    expect(next.columns).toEqual(DEFAULT_DASHBOARD_CONFIG.columns);
  });

  it("ignora painel_config_update de outro computador", () => {
    expect(
      isPainelConfigUpdateMessage(
        { type: "painel_config_update", target_client_id: "client-b-1234" },
        "client-a-1234",
      ),
    ).toBe(false);
    expect(
      isPainelConfigUpdateMessage(
        { type: "painel_config_update", target_client_id: "client-a-1234" },
        "client-a-1234",
      ),
    ).toBe(true);
  });
});
