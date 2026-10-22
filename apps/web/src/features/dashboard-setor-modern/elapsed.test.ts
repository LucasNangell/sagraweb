import { describe, expect, it } from "vitest";

import { elapsedParts, parseAndamentoTime } from "./elapsed";

describe("relógio de andamento", () => {
  it.each([
    "2026-10-22",
    "2026-10-22 00:00:00",
    "2026-10-22T00:00",
    "2026-10-22T00:00:00.000000",
    "2026-10-22T00:00:00Z",
    "2026-10-22T00:00:00-03:00",
  ])("combina %s com a hora registrada na observação", (date) => {
    expect(parseAndamentoTime(date, "  09h30\nRecebido para execução")).toBe(
      Date.parse("2026-10-22T12:30:00Z"),
    );
  });

  it("aceita o horário legado com uma casa na hora e H maiúsculo", () => {
    expect(parseAndamentoTime("2026-10-22", "9H05\nRecebido")).toBe(
      Date.parse("2026-10-22T12:05:00Z"),
    );
  });

  it.each([
    "2026-10-22T08:15:00-03:00",
    "2026-10-22T11:15:00Z",
    "2026-10-22T00:00:01-03:00",
    "2026-10-22T00:00:00.123-03:00",
  ])("preserva o horário completo de %s", (date) => {
    expect(parseAndamentoTime(date, "09h30\nRecebido")).toBe(Date.parse(date));
  });

  it.each([
    null,
    "",
    "25h10",
    "09h60",
    "109h30",
    "09h300",
    "Entregar às 15h30",
  ])("não usa uma observação sem carimbo válido (%s)", (observation) => {
    expect(parseAndamentoTime("2026-10-22", observation)).toBeNull();
    expect(parseAndamentoTime("2026-10-22 00:00:00", observation)).toBe(
      Date.parse("2026-10-22T03:00:00Z"),
    );
  });

  it("mantém meia-noite quando o horário da observação é 00h00", () => {
    expect(parseAndamentoTime("2026-10-22", "00h00\nEntrada")).toBe(
      Date.parse("2026-10-22T03:00:00Z"),
    );
  });

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
