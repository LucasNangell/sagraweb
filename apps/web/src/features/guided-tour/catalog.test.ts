import { describe, expect, it } from "vitest";

import { getTour, TOUR_CATALOG } from "./catalog";
import { ANDAMENTOS_TOUR_ID, ANDAMENTOS_TOUR_TITLE } from "./tours/andamentos";
import {
  PORTAL_APROVACAO_ALTERACOES_TOUR_ID,
  PORTAL_APROVACAO_TOUR_ID,
} from "./tourSeen";

describe("guided-tour catalog", () => {
  it("inclui o tutorial Como lançar andamentos?", () => {
    expect(TOUR_CATALOG).toContainEqual({
      id: ANDAMENTOS_TOUR_ID,
      title: ANDAMENTOS_TOUR_TITLE,
    });
    const tour = getTour("andamentos");
    expect(tour?.title).toBe(ANDAMENTOS_TOUR_TITLE);
    expect(tour?.steps.some((s) => s.id === "salvar")).toBe(true);
  });

  it("registra o tour do portal sem listar no menu Ajuda", () => {
    const tour = getTour(PORTAL_APROVACAO_TOUR_ID);
    expect(tour?.id).toBe(PORTAL_APROVACAO_TOUR_ID);
    expect(tour?.steps.at(-1)?.id).toBe("resposta");
    expect(tour?.steps.some((s) => s.id === "editable-fields")).toBe(false);
    const alteracoes = getTour(PORTAL_APROVACAO_ALTERACOES_TOUR_ID);
    expect(alteracoes?.steps.some((s) => s.id === "editable-fields")).toBe(true);
    expect(
      TOUR_CATALOG.some((item) => item.id === PORTAL_APROVACAO_ALTERACOES_TOUR_ID),
    ).toBe(false);
    expect(TOUR_CATALOG.some((item) => item.id === PORTAL_APROVACAO_TOUR_ID)).toBe(
      false,
    );
  });
});
