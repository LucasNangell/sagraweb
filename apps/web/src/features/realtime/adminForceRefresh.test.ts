import { describe, expect, it } from "vitest";

import {
  isAdminForceReload,
  shouldReloadForAdminEpoch,
} from "./adminForceRefresh";

describe("isAdminForceReload", () => {
  it("detecta comando do painel de usuários", () => {
    expect(
      isAdminForceReload({
        type: "force_refresh",
        action: "reload",
        origem: "admin_panel",
      }),
    ).toBe(true);
  });

  it("detecta action reload mesmo sem origem", () => {
    expect(
      isAdminForceReload({
        type: "force_refresh",
        action: "reload",
      }),
    ).toBe(true);
  });

  it("não recarrega reconciliação da home", () => {
    expect(
      isAdminForceReload({
        type: "force_refresh",
        scope: "os_search",
        origem: "reconcile",
      }),
    ).toBe(false);
  });

  it("ignora outros eventos WS", () => {
    expect(isAdminForceReload({ type: "system_update" })).toBe(false);
    expect(isAdminForceReload(null)).toBe(false);
  });
});

describe("shouldReloadForAdminEpoch", () => {
  it("não recarrega no baseline (primeiro GET)", () => {
    expect(shouldReloadForAdminEpoch(4, null)).toBe(false);
  });

  it("recarrega quando o epoch do servidor avança", () => {
    expect(shouldReloadForAdminEpoch(5, 4)).toBe(true);
  });

  it("não recarrega epoch igual ou menor", () => {
    expect(shouldReloadForAdminEpoch(4, 4)).toBe(false);
    expect(shouldReloadForAdminEpoch(3, 4)).toBe(false);
  });

  it("ignora epoch zero (nunca houve comando)", () => {
    expect(shouldReloadForAdminEpoch(0, 0)).toBe(false);
    expect(shouldReloadForAdminEpoch(0, null)).toBe(false);
  });
});
