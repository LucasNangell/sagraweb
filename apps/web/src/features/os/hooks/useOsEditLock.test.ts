import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  osEditLockAlertMessage,
  useOsEditLock,
} from "./useOsEditLock";

const acquireOsEditLock = vi.fn();
const heartbeatOsEditLock = vi.fn();
const releaseOsEditLock = vi.fn();
const releaseOsEditLockKeepalive = vi.fn();

vi.mock("@/api/os", () => ({
  acquireOsEditLock: (...args: unknown[]) => acquireOsEditLock(...args),
  heartbeatOsEditLock: (...args: unknown[]) => heartbeatOsEditLock(...args),
  releaseOsEditLock: (...args: unknown[]) => releaseOsEditLock(...args),
  releaseOsEditLockKeepalive: (...args: unknown[]) =>
    releaseOsEditLockKeepalive(...args),
}));

describe("osEditLockAlertMessage", () => {
  it("usa a mensagem da API (409 com nome do holder)", () => {
    expect(
      osEditLockAlertMessage(
        new Error(
          "O usuário Maria Silva (ponto 918713) está editando esta OS no momento. Não é possível editá-la.",
        ),
      ),
    ).toContain("Maria Silva");
  });

  it("tem fallback quando o erro não tem mensagem", () => {
    expect(osEditLockAlertMessage({})).toBe(
      "Não é possível editar esta OS no momento.",
    );
  });
});

describe("useOsEditLock", () => {
  beforeEach(() => {
    acquireOsEditLock.mockReset();
    heartbeatOsEditLock.mockReset();
    releaseOsEditLock.mockReset();
    releaseOsEditLockKeepalive.mockReset();
    vi.stubGlobal("alert", vi.fn());
    acquireOsEditLock.mockResolvedValue({ held: true, token: "t" });
    releaseOsEditLock.mockResolvedValue({ released: true });
  });

  it("adquire o lock e marca held", async () => {
    const { result } = renderHook(() =>
      useOsEditLock({ ano: 2026, id: 3100, origem: "os_edit" }),
    );

    await act(async () => {
      const ok = await result.current.acquire();
      expect(ok).toBe(true);
    });

    expect(result.current.held).toBe(true);
    expect(result.current.blocked).toBe(false);
    expect(acquireOsEditLock).toHaveBeenCalledWith(
      2026,
      3100,
      expect.objectContaining({ origem: "os_edit" }),
    );
  });

  it("alerta e não entra em edição quando outro usuário segura o lock", async () => {
    acquireOsEditLock.mockRejectedValue(
      new Error(
        "O usuário Maria Silva (ponto 918713) está editando esta OS no momento. Não é possível editá-la.",
      ),
    );
    const { result } = renderHook(() =>
      useOsEditLock({ ano: 2026, id: 3100, origem: "andamento" }),
    );

    await act(async () => {
      const ok = await result.current.acquire();
      expect(ok).toBe(false);
    });

    expect(result.current.held).toBe(false);
    expect(result.current.blocked).toBe(true);
    expect(window.alert).toHaveBeenCalledWith(
      expect.stringContaining("Maria Silva"),
    );
  });

  it("libera o lock no release", async () => {
    const { result } = renderHook(() =>
      useOsEditLock({ ano: 2026, id: 3100, origem: "os_edit" }),
    );
    await act(async () => {
      await result.current.acquire();
    });
    await act(async () => {
      await result.current.release();
    });
    await waitFor(() => {
      expect(result.current.held).toBe(false);
    });
    expect(releaseOsEditLock).toHaveBeenCalled();
  });
});
