import { describe, expect, it } from "vitest";

import { elapsedParts, parseAndamentoTime } from "./elapsed";

describe("relógio de andamento", () => {
  it("interpreta timestamps do banco em Brasília sem depender do fuso do monitor", () => {
    expect(parseAndamentoTime("2026-10-21 09:30:00")).toBe(
      Date.parse("2026-10-21T12:30:00Z"),
    );
    expect(parseAndamentoTime("2026-10-21T09:30:00.123")).toBe(
      Date.parse("2026-10-21T12:30:00.123Z"),
    );
  });

  it("preserva offsets explícitos e rejeita datas ausentes ou inválidas", () => {
    expect(parseAndamentoTime("2026-10-21T12:30:00Z")).toBe(
      Date.parse("2026-10-21T12:30:00Z"),
    );
    expect(parseAndamentoTime("2026-10-21T09:30:00-03:00")).toBe(
      Date.parse("2026-10-21T12:30:00Z"),
    );
    for (const value of [
      null,
      "",
      "inválida",
      "2026-99-99T22:00:00",
      "2026-10-21",
    ])
      expect(parseAndamentoTime(value)).toBeNull();
  });

  it("atravessa dias e a virada de minuto sem reiniciar o tempo", () => {
    const start = Date.parse("2026-10-20T12:00:00Z");
    expect(elapsedParts(start, start + 90061000)).toEqual({
      days: 1,
      hours: "01",
      minutes: "01",
      seconds: "01",
      totalSeconds: 90061,
    });
    expect(elapsedParts(start, start + 60000)).toMatchObject({
      minutes: "01",
      seconds: "00",
    });
    expect(elapsedParts(start, start)).toMatchObject({
      hours: "00",
      minutes: "00",
      seconds: "00",
    });
  });

  it("não inventa um tempo para datas futuras ou ausentes", () => {
    expect(elapsedParts(null, Date.now())).toBeNull();
    expect(elapsedParts(2000, 1000)).toBeNull();
  });
});
