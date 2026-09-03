import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

import { useSyncAndamentosServiceAlert } from "./useSyncAndamentosServiceAlert";

const fetchMock = vi.fn();

vi.mock("./api", () => ({
  fetchSyncAndamentosServiceStatus: () => fetchMock(),
}));

describe("useSyncAndamentosServiceAlert", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("liga alerta quando a API retorna alert:true", async () => {
    fetchMock.mockResolvedValue({
      service_name: "SAGRA-SyncAndamentos",
      exists: true,
      status: "Stopped",
      query_ok: true,
      healthy: false,
      alert: true,
    });

    const { result } = renderHook(() => useSyncAndamentosServiceAlert());

    await waitFor(() => {
      expect(result.current).toBe(true);
    });
  });

  it("não liga alerta quando a API falha", async () => {
    fetchMock.mockRejectedValue(new Error("network"));

    const { result } = renderHook(() => useSyncAndamentosServiceAlert());

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });
    expect(result.current).toBe(false);
  });

  it("desliga quando enabled=false", async () => {
    fetchMock.mockResolvedValue({
      alert: true,
      healthy: false,
      exists: false,
      status: null,
      query_ok: true,
      service_name: "SAGRA-SyncAndamentos",
    });

    const { result } = renderHook(() => useSyncAndamentosServiceAlert(false));

    expect(result.current).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
