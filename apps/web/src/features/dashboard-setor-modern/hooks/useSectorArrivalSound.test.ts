import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { resetNotificationSoundPlayback } from "@/features/dashboard-setor/notificationSounds";
import { useSectorArrivalSound } from "./useSectorArrivalSound";

function mockAudio() {
  const play = vi.fn(async () => {});
  const pause = vi.fn();
  vi.stubGlobal(
    "Audio",
    vi.fn(function (this: { src: string; play: typeof play; pause: typeof pause }, src?: string) {
      this.src = src || "";
      this.play = play;
      this.pause = pause;
      return this;
    }),
  );
  return { play, pause };
}

afterEach(() => {
  cleanup();
  resetNotificationSoundPlayback();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("toque de chegada", () => {
  it("toca o preset suave por padrão", async () => {
    const { play } = mockAudio();
    const { result } = renderHook(() => useSectorArrivalSound());
    await act(() => result.current.playArrivalSound());
    expect(play).toHaveBeenCalledOnce();
  });

  it("toca o som da prioridade alta mesmo com o normal mudo", async () => {
    const { play } = mockAudio();
    const { result } = renderHook(() =>
      useSectorArrivalSound({
        high: { preset: "bell" },
        normal: { preset: "none" },
      }),
    );
    await act(() => result.current.playArrivalSound("high"));
    expect(play).toHaveBeenCalledOnce();
  });

  it("não toca quando o som está desligado", async () => {
    const { play } = mockAudio();
    const { result } = renderHook(() =>
      useSectorArrivalSound({ normal: { preset: "none" } }),
    );
    await act(() => result.current.playArrivalSound());
    expect(play).not.toHaveBeenCalled();
  });

  it("desbloqueia o áudio na primeira interação", () => {
    mockAudio();
    renderHook(() => useSectorArrivalSound());
    act(() => window.dispatchEvent(new Event("pointerdown")));
    expect(Audio).toHaveBeenCalled();
  });
});
