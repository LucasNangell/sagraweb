import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ADMIN_RELOAD_JITTER_MS,
  applyAdminClientReload,
  isAdminForceReload,
  resetAdminClientReloadGateForTests,
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

describe("applyAdminClientReload jitter", () => {
  beforeEach(() => {
    resetAdminClientReloadGateForTests();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    resetAdminClientReloadGateForTests();
    vi.restoreAllMocks();
  });

  it("atrasa location.reload com jitter antes de recarregar", async () => {
    const reload = vi.fn();
    vi.stubGlobal("location", { reload });
    vi.spyOn(Math, "random").mockReturnValue(0.5);

    const pending = applyAdminClientReload(false);
    expect(reload).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(ADMIN_RELOAD_JITTER_MS * 0.5 - 1);
    expect(reload).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
