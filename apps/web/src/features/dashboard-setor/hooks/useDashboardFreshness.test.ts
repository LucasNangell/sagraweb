import { describe, expect, it } from "vitest";

import {
  DASHBOARD_STALE_LIVE_MS,
  DASHBOARD_STALE_POLL_MS,
} from "../constants";
import { computeDashboardFreshness } from "./useDashboardFreshness";

describe("computeDashboardFreshness", () => {
  const baseNow = 1_700_000_000_000;

  it("retorna loading antes da primeira sincronização", () => {
    const result = computeDashboardFreshness({
      hasLoadedOnce: false,
      lastSyncAt: null,
      wsStatus: "disconnected",
      now: baseNow,
    });
    expect(result.level).toBe("loading");
    expect(result.statusClass).toBe("disconnected");
    expect(result.label).toBe("Carregando dados");
  });

  it("retorna live com WS conectado e sync recente", () => {
    const result = computeDashboardFreshness({
      hasLoadedOnce: true,
      lastSyncAt: baseNow - 10_000,
      wsStatus: "connected",
      now: baseNow,
    });
    expect(result.level).toBe("live");
    expect(result.statusClass).toBe("connected");
    expect(result.label).toMatch(/^Atualizado às /);
    expect(result.label).not.toContain("sem tempo real");
  });

  it("retorna degraded sem WS com sync dentro do limite de polling", () => {
    const result = computeDashboardFreshness({
      hasLoadedOnce: true,
      lastSyncAt: baseNow - Math.min(DASHBOARD_STALE_POLL_MS - 1_000, 30_000),
      wsStatus: "disconnected",
      now: baseNow,
    });
    expect(result.level).toBe("degraded");
    expect(result.statusClass).toBe("degraded");
    expect(result.label).toMatch(/^Atualizado às /);
    expect(result.label).not.toContain("sem tempo real");
    expect(result.label).not.toContain("dados desatualizados");
  });

  it("retorna stale quando a idade passa do limite live mesmo com WS", () => {
    const result = computeDashboardFreshness({
      hasLoadedOnce: true,
      lastSyncAt: baseNow - (DASHBOARD_STALE_LIVE_MS + 1_000),
      wsStatus: "connected",
      now: baseNow,
    });
    expect(result.level).toBe("stale");
    expect(result.statusClass).toBe("disconnected");
    expect(result.label).toContain("dados desatualizados");
  });

  it("retorna stale sem WS quando a idade passa do limite de polling", () => {
    const result = computeDashboardFreshness({
      hasLoadedOnce: true,
      lastSyncAt: baseNow - (DASHBOARD_STALE_POLL_MS + 1_000),
      wsStatus: "error",
      fetchError: "timeout",
      now: baseNow,
    });
    expect(result.level).toBe("stale");
    expect(result.statusClass).toBe("disconnected");
    expect(result.label).toContain("dados desatualizados");
  });
});
