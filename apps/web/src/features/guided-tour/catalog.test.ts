import { describe, expect, it } from "vitest";

import { getTour, TOUR_CATALOG } from "./catalog";
import { ANDAMENTOS_TOUR_ID, ANDAMENTOS_TOUR_TITLE } from "./tours/andamentos";

describe("guided-tour catalog", () => {
  it("inclui o tutorial Como fazer andamentos?", () => {
    expect(TOUR_CATALOG).toContainEqual({
      id: ANDAMENTOS_TOUR_ID,
      title: ANDAMENTOS_TOUR_TITLE,
    });
    const tour = getTour("andamentos");
    expect(tour?.title).toBe("Como fazer andamentos?");
    expect(tour?.steps.some((s) => s.id === "salvar")).toBe(true);
  });
});
