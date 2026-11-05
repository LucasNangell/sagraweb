import { afterEach, describe, expect, it, vi } from "vitest";

import { toast, useToastStore } from "./toastStore";

describe("toastStore", () => {
  afterEach(() => {
    toast.clear();
    vi.useRealTimers();
  });

  it("empilha toasts e remove após 3s", () => {
    vi.useFakeTimers();
    toast.success("Andamento excluído e lista reorganizada.");
    expect(useToastStore.getState().items).toHaveLength(1);
    expect(useToastStore.getState().items[0]?.variant).toBe("success");
    expect(useToastStore.getState().items[0]?.message).toContain("excluído");

    vi.advanceTimersByTime(2999);
    expect(useToastStore.getState().items).toHaveLength(1);

    vi.advanceTimersByTime(1);
    expect(useToastStore.getState().items).toHaveLength(0);
  });
});
