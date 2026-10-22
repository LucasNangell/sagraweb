import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AndamentoClock, AndamentoTimer } from "./AndamentoTimer";
import { ModernQueueCard } from "./ModernQueueCard";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("temporizador ao vivo", () => {
  it("usa a hora da observação no card e recalcula quando somente ela muda", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-22T14:00:00Z"));
    const card = (observation: string) => (
      <AndamentoClock>
        <ModernQueueCard
          item={{
            nr_os: 1428,
            ano: 2026,
            uniqueKey: "1428-2026",
            pcp_ordem: null,
            displaySituacao: "Em Execução",
            priorityType: null,
            isNew: false,
            last_update: "2026-10-22 00:00:00",
            observacao: observation,
          }}
          index={0}
        />
      </AndamentoClock>
    );
    const { rerender } = render(card("09h30\nRecebido"));
    expect(screen.getByRole("timer")).toHaveTextContent("01:30:00");
    expect(screen.getByTitle(/Último andamento:.*09:30:00/)).toBeVisible();
    rerender(card("09h45\nRecebido"));
    expect(screen.getByRole("timer")).toHaveTextContent("01:15:00");
  });

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
