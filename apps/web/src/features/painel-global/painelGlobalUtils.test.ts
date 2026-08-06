import { describe, expect, it } from "vitest";

import {
  getPrioScore,
  masterSort,
  resolvePainelPrioridade,
} from "./painelGlobalUtils";
import type { PainelOpItem } from "./types";

function makeItem(
  partial: Partial<PainelOpItem> & Pick<PainelOpItem, "nr_os" | "ano">,
): PainelOpItem {
  return {
    uniqueKey: `${partial.nr_os}-${partial.ano}`,
    priorityType: null,
    isNew: false,
    lastColumnId: null,
    sourceOrder: 0,
    displaySituacao: "",
    normalizedEntrega: null,
    normalizedSolicitante: "",
    normalizedTurno: null,
    ...partial,
  };
}

describe("painelGlobalUtils / prioridade", () => {
  it("classifica Prometido, Solicitado e Normal", () => {
    expect(getPrioScore("Prometido p/")).toBe(1);
    expect(getPrioScore("Solicitado p/")).toBe(2);
    expect(getPrioScore("Normal")).toBe(3);
    expect(getPrioScore(resolvePainelPrioridade({ prioridade: null, EntregPrazoLink: "Prometido p/" }))).toBe(1);
  });

  it("masterSort ordena Prometido antes de Solicitado e Normal", () => {
    const prometido = makeItem({
      nr_os: 100,
      ano: 2026,
      prioridade: "Prometido p/",
      pcp_ordem: 99,
    });
    const solicitado = makeItem({
      nr_os: 200,
      ano: 2026,
      prioridade: "Solicitado p/",
      pcp_ordem: 1,
    });
    const normal = makeItem({
      nr_os: 300,
      ano: 2026,
      prioridade: "Normal",
      pcp_ordem: 0,
    });

    const sorted = [normal, solicitado, prometido].sort(masterSort);
    expect(sorted.map((item) => item.prioridade)).toEqual([
      "Prometido p/",
      "Solicitado p/",
      "Normal",
    ]);
  });
});
