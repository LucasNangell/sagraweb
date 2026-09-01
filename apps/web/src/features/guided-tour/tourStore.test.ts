import { afterEach, describe, expect, it } from "vitest";

import { useGuidedTourStore } from "./tourStore";

describe("guided-tour store", () => {
  afterEach(() => {
    useGuidedTourStore.getState().stop();
  });

  it("inicia o tour de andamentos no primeiro passo", () => {
    useGuidedTourStore.getState().start("andamentos");
    expect(useGuidedTourStore.getState().tourId).toBe("andamentos");
    expect(useGuidedTourStore.getState().stepIndex).toBe(0);
  });

  it("avança e encerra no último passo", () => {
    useGuidedTourStore.getState().start("andamentos");
    for (let i = 0; i < 20; i += 1) {
      if (!useGuidedTourStore.getState().tourId) {
        break;
      }
      useGuidedTourStore.getState().next();
    }
    expect(useGuidedTourStore.getState().tourId).toBeNull();
    expect(useGuidedTourStore.getState().stepIndex).toBe(0);
  });

  it("ignora id desconhecido", () => {
    useGuidedTourStore.getState().start("inexistente");
    expect(useGuidedTourStore.getState().tourId).toBeNull();
  });
});
