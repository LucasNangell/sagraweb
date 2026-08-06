import { describe, expect, it, beforeEach } from "vitest";

import {
  matchesViewingGravacaoExternaOs,
  shouldSuppressGravacaoExternaNotification,
  useGravacaoExternaUiStore,
} from "./gravacaoExternaUiStore";

describe("gravacaoExternaUiStore", () => {
  beforeEach(() => {
    useGravacaoExternaUiStore.setState({ viewingOs: null });
  });

  it("suprime notificação quando a OS está aberta", () => {
    useGravacaoExternaUiStore.getState().setViewingOs(2026, 1036);
    expect(
      shouldSuppressGravacaoExternaNotification({
        tipo: "gravacao_externa_mensagem",
        os_ano: 2026,
        os_nro: 1036,
      }),
    ).toBe(true);
    expect(matchesViewingGravacaoExternaOs(2026, 1036)).toBe(true);
    expect(
      shouldSuppressGravacaoExternaNotification({
        tipo: "gravacao_externa_mensagem",
        os_ano: 2026,
        os_nro: 9999,
      }),
    ).toBe(false);
  });
});
