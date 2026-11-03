import { describe, expect, it } from "vitest";

import {
  MAX_CUSTOM_NOTIFICATION_BYTES,
  isCustomNotificationDataUrl,
  normalizeNotificationSound,
  normalizeNotificationSounds,
  notificationSoundSrc,
  pickHighestSoundSlot,
  resolveNotificationSoundForSlot,
} from "./notificationSounds";

describe("sons de notificação", () => {
  it("omite o preset suave (padrão)", () => {
    expect(normalizeNotificationSound({ preset: "suave" })).toBeUndefined();
    expect(normalizeNotificationSound({ preset: "chime" })).toEqual({
      preset: "chime",
    });
    expect(normalizeNotificationSound({ preset: "none" })).toEqual({
      preset: "none",
    });
  });

  it("aceita MP3 customizado em data URL", () => {
    const dataUrl = `data:audio/mpeg;base64,${"A".repeat(24)}`;
    expect(
      normalizeNotificationSound({
        preset: "custom",
        customName: "meu.mp3",
        customDataUrl: dataUrl,
      }),
    ).toEqual({
      preset: "custom",
      customName: "meu.mp3",
      customDataUrl: dataUrl,
    });
    expect(isCustomNotificationDataUrl(dataUrl)).toBe(true);
    expect(MAX_CUSTOM_NOTIFICATION_BYTES).toBeGreaterThan(100_000);
  });

  it("resolve o arquivo do catálogo e silêncio", () => {
    expect(notificationSoundSrc({ preset: "none" })).toBeNull();
    expect(notificationSoundSrc({ preset: "ping" })).toMatch(/sounds\/ping\.wav$/);
    expect(notificationSoundSrc(undefined)).toMatch(/sounds\/suave\.wav$/);
  });

  it("normaliza toques por prioridade e herda o som legado", () => {
    expect(
      normalizeNotificationSounds({
        high: { preset: "ping" },
        medium: { preset: "suave" },
        normal: { preset: "none" },
      }),
    ).toEqual({
      high: { preset: "ping" },
      medium: { preset: "suave" },
      normal: { preset: "none" },
    });
    expect(
      resolveNotificationSoundForSlot(
        { high: { preset: "bell" } },
        "medium",
        { preset: "chime" },
      ),
    ).toEqual({ preset: "chime" });
    expect(pickHighestSoundSlot(["priority-medium", null])).toBe("medium");
    expect(pickHighestSoundSlot(["priority-medium", "priority-high"])).toBe(
      "high",
    );
  });
});
