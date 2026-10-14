import { describe, expect, it } from "vitest";

import { gravacaoOsGroupKey, groupGravacaoItemsByOs } from "./groupGravacaoItemsByOs";

type Item = {
  id: number;
  nr_os: number;
  ano: number;
  componente?: string;
  membros?: { nr_os: number; ano: number }[];
};

const byId = (item: Item) => item.id;

describe("groupGravacaoItemsByOs", () => {
  it("junta capa e miolo da mesma OS em um card, ordenando por componente", () => {
    const items: Item[] = [
      { id: 2, nr_os: 100, ano: 2026, componente: "miolo" },
      { id: 1, nr_os: 100, ano: 2026, componente: "capa" },
      { id: 3, nr_os: 200, ano: 2026, componente: "todos" },
    ];
    const groups = groupGravacaoItemsByOs(items, byId);
    expect(groups).toHaveLength(2);
    expect(groups[0]!.key).toBe("2026-100");
    expect(groups[0]!.anchor.id).toBe(2);
    expect(groups[0]!.sessions.map((s) => s.id)).toEqual([1, 2]);
    expect(groups[1]!.sessions.map((s) => s.id)).toEqual([3]);
  });

  it("mantém partes do mesmo componente como sessões distintas do card", () => {
    const items: Item[] = [
      { id: 7, nr_os: 100, ano: 2026, componente: "capa" },
      { id: 5, nr_os: 100, ano: 2026, componente: "capa" },
    ];
    const [group] = groupGravacaoItemsByOs(items, byId);
    expect(group!.sessions.map((s) => s.id)).toEqual([5, 7]);
  });

  it("agrupa juntadas pelas OSs membro e não mistura com a OS solo", () => {
    const juntada = [
      { nr_os: 100, ano: 2026 },
      { nr_os: 101, ano: 2026 },
    ];
    const items: Item[] = [
      { id: 1, nr_os: 100, ano: 2026, componente: "capa", membros: juntada },
      { id: 2, nr_os: 100, ano: 2026, componente: "miolo", membros: [...juntada].reverse() },
      { id: 3, nr_os: 100, ano: 2026, membros: [{ nr_os: 100, ano: 2026 }] },
    ];
    const groups = groupGravacaoItemsByOs(items, byId);
    expect(groups.map((g) => g.key)).toEqual(["2026-100|2026-101", "2026-100"]);
    expect(groups[0]!.sessions.map((s) => s.id)).toEqual([1, 2]);
  });

  it("gera chave pela própria OS quando não há membros", () => {
    expect(gravacaoOsGroupKey({ nr_os: 9, ano: 2025 })).toBe("2025-9");
  });
});
