import { describe, expect, it } from "vitest";

import type { AppNotification } from "./types";
import {
  isOsWatchNotification,
  selectOsWatchCatchUp,
} from "./osWatchNativeCatchUp";

function item(
  id: number,
  type: string,
): AppNotification {
  return {
    Id: id,
    Mensagem: `msg ${id}`,
    NroProtocolo: 10,
    AnoProtocolo: 2026,
    DetalhesJson: JSON.stringify({ type }),
  };
}

describe("osWatchNativeCatchUp", () => {
  it("reconhece andamento e alteração de OS", () => {
    expect(isOsWatchNotification(item(1, "os_watch_andamento"))).toBe(true);
    expect(isOsWatchNotification(item(2, "os_watch_change"))).toBe(true);
    expect(isOsWatchNotification(item(3, "support_reply"))).toBe(false);
  });

  it("não seleciona itens já exibidos", () => {
    const plan = selectOsWatchCatchUp(
      [item(1, "os_watch_andamento"), item(2, "os_watch_change")],
      (id) => id === 1,
    );
    expect(plan.kind).toBe("individual");
    expect(plan.items.map((row) => row.Id)).toEqual([2]);
  });

  it("resume quando há mais de 3 pendentes", () => {
    const list = [1, 2, 3, 4, 5].map((id) => item(id, "os_watch_andamento"));
    const plan = selectOsWatchCatchUp(list, () => false);
    expect(plan.kind).toBe("summary");
    expect(plan.items).toHaveLength(5);
  });

  it("retorna none quando a lista está vazia ou já vista", () => {
    expect(selectOsWatchCatchUp([], () => false).kind).toBe("none");
    expect(
      selectOsWatchCatchUp([item(1, "os_watch_andamento")], () => true).kind,
    ).toBe("none");
  });
});
