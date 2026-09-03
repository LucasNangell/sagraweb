import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DevFeaturesConfig } from "@/features/configuracoes/types";

const fetchDevFeatures = vi.fn();

vi.mock("@/api/devFeatures", () => ({
  fetchDevFeatures: (...args: unknown[]) => fetchDevFeatures(...args),
}));

import { useDevFeature } from "./useDevFeature";

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("useDevFeature", () => {
  beforeEach(() => {
    fetchDevFeatures.mockReset();
  });

  it("retorna false enquanto carrega ou em erro", async () => {
    fetchDevFeatures.mockRejectedValue(new Error("fail"));
    const { result } = renderHook(() => useDevFeature("sequencia_producao"), {
      wrapper,
    });
    expect(result.current).toBe(false);
    await waitFor(() => expect(fetchDevFeatures).toHaveBeenCalled());
    expect(result.current).toBe(false);
  });

  it("retorna true quando a flag está habilitada", async () => {
    const payload: DevFeaturesConfig = {
      features: [
        {
          id: "sequencia_producao",
          label: "Sequência de produção",
          description: "desc",
          enabled: true,
        },
      ],
      enabled: { sequencia_producao: true },
    };
    fetchDevFeatures.mockResolvedValue(payload);
    const { result } = renderHook(() => useDevFeature("sequencia_producao"), {
      wrapper,
    });
    await waitFor(() => expect(result.current).toBe(true));
  });
});
