import { describe, expect, it } from "vitest";

import type { AnaliseSelectedItem, OsVersionItem } from "./types";
import {
  EXECUTION_OBS_DEFAULT,
  resolveAnaliseFinishDecision,
} from "./utils";

const versions: OsVersionItem[] = [
  { version: 1, label: "Original V1", path: "v1" },
  { version: 2, label: "Original V2", path: "v2" },
];

function item(
  partial: Partial<AnaliseSelectedItem> & Pick<AnaliseSelectedItem, "uniqueId" | "versaoOrigem">,
): AnaliseSelectedItem {
  return {
    titulo: "Problema",
    html: "",
    obs: "",
    componenteOrigem: "Capa",
    ...partial,
  };
}

describe("resolveAnaliseFinishDecision", () => {
  it("abre Em Execução quando a v2 não tem itens, mesmo com problemas na v1", () => {
    const decision = resolveAnaliseFinishDecision(
      [item({ uniqueId: 1, versaoOrigem: "Original V1" })],
      versions,
      "v2",
    );
    expect(decision).toEqual({
      kind: "execution_empty",
      observacao: EXECUTION_OBS_DEFAULT,
    });
  });

  it("segue Problemas Técnicos quando a v2 tem item ativo", () => {
    const decision = resolveAnaliseFinishDecision(
      [
        item({ uniqueId: 1, versaoOrigem: "v1" }),
        item({ uniqueId: 2, versaoOrigem: "Original V2" }),
      ],
      versions,
      "v2",
    );
    expect(decision.kind).toBe("continue_pt");
  });

  it("abre Em Execução com correções só da versão atual", () => {
    const decision = resolveAnaliseFinishDecision(
      [
        item({ uniqueId: 1, versaoOrigem: "v1", titulo: "Antigo" }),
        item({
          uniqueId: 2,
          versaoOrigem: "v2",
          titulo: "Sangria",
          corrigidoSefoc: true,
          obsCorrecaoSefoc: "Ajustado",
        }),
      ],
      versions,
      "v2",
    );
    expect(decision.kind).toBe("execution_corrected");
    if (decision.kind !== "execution_corrected") return;
    expect(decision.observacao).toContain("Sangria");
    expect(decision.observacao).toContain("Ajustado");
    expect(decision.observacao).toContain(EXECUTION_OBS_DEFAULT);
    expect(decision.observacao).not.toContain("Antigo");
  });
});
