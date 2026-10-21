import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useSectorArrivalSound } from "./useSectorArrivalSound";

function mockAudio() {
  const oscillators: { start: ReturnType<typeof vi.fn>; type: string }[] = [];
  const peaks: number[] = [];
  const ctx = {
    state: "running",
    currentTime: 0,
    destination: {},
    resume: vi.fn(async () => {
      ctx.state = "running";
    }),
    close: vi.fn(async () => {
      ctx.state = "closed";
    }),
    createOscillator: vi.fn(() => {
      const oscillator = {
        type: "",
        frequency: { setValueAtTime: vi.fn() },
        connect: vi.fn(),
        disconnect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
        onended: null,
      };
      oscillators.push(oscillator);
      return oscillator;
    }),
    createGain: vi.fn(() => ({
      gain: {
        setValueAtTime: vi.fn(),
        linearRampToValueAtTime: vi.fn((value: number) => {
          peaks.push(value);
        }),
        exponentialRampToValueAtTime: vi.fn(),
      },
      connect: vi.fn(),
      disconnect: vi.fn(),
    })),
  };
  vi.stubGlobal(
    "AudioContext",
    vi.fn(function () {
      return ctx;
    }),
  );
  return { ctx, oscillators, peaks };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("toque suave de chegada", () => {
  it("toca duas notas senoidais de baixo volume e evita sobreposição", async () => {
    const { ctx, oscillators, peaks } = mockAudio();
    const { result } = renderHook(useSectorArrivalSound);
    await act(() => result.current.playArrivalSound());
    expect(oscillators).toHaveLength(2);
    expect(oscillators.every((oscillator) => oscillator.type === "sine")).toBe(
      true,
    );
    expect(Math.max(...peaks)).toBeLessThanOrEqual(0.035);
    await act(() => result.current.playArrivalSound());
    expect(oscillators).toHaveLength(2);
    ctx.currentTime = 1;
    await act(() => result.current.playArrivalSound());
    expect(oscillators).toHaveLength(4);
  });

  it("não toca uma chegada antiga após desbloqueio tardio do autoplay", async () => {
    const { ctx, oscillators } = mockAudio();
    ctx.state = "suspended";
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    ctx.resume.mockImplementation(async () => {
      now = 2000;
      ctx.state = "running";
    });
    const { result } = renderHook(useSectorArrivalSound);
    await act(() => result.current.playArrivalSound());
    expect(oscillators).toHaveLength(0);
  });

  it("desbloqueia silenciosamente na interação e fecha o contexto ao sair", () => {
    const { ctx, oscillators } = mockAudio();
    ctx.state = "suspended";
    const { unmount } = renderHook(useSectorArrivalSound);
    act(() => window.dispatchEvent(new Event("pointerdown")));
    expect(ctx.resume).toHaveBeenCalledOnce();
    expect(oscillators).toHaveLength(0);
    unmount();
    expect(ctx.close).toHaveBeenCalledOnce();
  });
});
