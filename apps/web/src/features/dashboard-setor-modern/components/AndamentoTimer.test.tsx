import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AndamentoClock, AndamentoTimer } from "./AndamentoTimer";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("temporizador ao vivo", () => {
  it("avança sem remontar o painel e recalcula quando muda o andamento", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-21T12:00:59Z"));
    const { rerender } = render(
      <AndamentoClock>
        <AndamentoTimer since="2026-10-21 09:00:00" />
      </AndamentoClock>,
    );
    expect(screen.getByRole("timer")).toHaveTextContent("00:00:59");
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.getByRole("timer")).toHaveTextContent("00:01:00");
    rerender(
      <AndamentoClock>
        <AndamentoTimer since="2026-10-21 09:01:00" />
      </AndamentoClock>,
    );
    expect(screen.getByRole("timer")).toHaveTextContent("00:00:00");
    expect(screen.getByRole("timer")).toHaveAttribute("aria-live", "off");
  });

  it("informa quando não existe horário e remove o intervalo ao desmontar", () => {
    vi.useFakeTimers();
    const { unmount } = render(
      <AndamentoClock>
        <AndamentoTimer />
      </AndamentoClock>,
    );
    expect(screen.getByRole("timer")).toHaveTextContent("Sem horário");
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
