import { afterEach, describe, expect, it } from "vitest";

import { hasSeenTour } from "./tourSeen";
import { useGuidedTourStore } from "./tourStore";

describe("guided-tour store", () => {
  afterEach(() => {
    localStorage.clear();
    useGuidedTourStore.getState().stop();
  });

  it("inicia o tour de andamentos no primeiro passo", () => {
    useGuidedTourStore.getState().start("andamentos");
    expect(useGuidedTourStore.getState().tourId).toBe("andamentos");
    expect(useGuidedTourStore.getState().stepIndex).toBe(0);
  });

  it("avança e conclui no último passo marcando como visto", () => {
    useGuidedTourStore.getState().start("andamentos");
    for (let i = 0; i < 40; i += 1) {
      if (!useGuidedTourStore.getState().tourId) {
        break;
      }
      useGuidedTourStore.getState().next();
    }
    expect(useGuidedTourStore.getState().tourId).toBeNull();
    expect(useGuidedTourStore.getState().stepIndex).toBe(0);
    expect(hasSeenTour("andamentos")).toBe(true);
  });

  it("ignora id desconhecido", () => {
    useGuidedTourStore.getState().start("inexistente");
    expect(useGuidedTourStore.getState().tourId).toBeNull();
  });
});
