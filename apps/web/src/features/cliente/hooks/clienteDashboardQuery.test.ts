import { describe, expect, it } from "vitest";

import {
  CLIENTE_DASHBOARD_REFETCH_INTERVAL_MS,
  CLIENTE_DASHBOARD_STALE_MS,
  clienteDashboardQueryKey,
  clienteDashboardQueryOptions,
} from "./clienteDashboardQuery";

describe("clienteDashboardQueryOptions", () => {
  it("configura staleTime e refetchInterval de 60 segundos", () => {
    const options = clienteDashboardQueryOptions();

    expect(options.queryKey).toEqual(clienteDashboardQueryKey);
    expect(options.staleTime).toBe(CLIENTE_DASHBOARD_STALE_MS);
    expect(options.refetchInterval).toBe(CLIENTE_DASHBOARD_REFETCH_INTERVAL_MS);
    expect(options.staleTime).toBe(60_000);
    expect(options.refetchInterval).toBe(60_000);
    expect(options.refetchOnWindowFocus).toBe(true);
  });
});
