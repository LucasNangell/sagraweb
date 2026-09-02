import { afterEach, describe, expect, it } from "vitest";

import {
  hasSeenPortalAprovacaoAlteracoesTour,
  hasSeenPortalAprovacaoTour,
  hasSeenTour,
  markTourSeen,
  PORTAL_APROVACAO_ALTERACOES_TOUR_ID,
  PORTAL_APROVACAO_TOUR_ID,
  tourSeenStorageKey,
} from "./tourSeen";
import { useGuidedTourStore } from "./tourStore";

describe("tourSeen", () => {
  afterEach(() => {
    localStorage.clear();
    useGuidedTourStore.getState().stop();
  });

  it("começa como não visto", () => {
    expect(hasSeenPortalAprovacaoTour()).toBe(false);
    expect(hasSeenTour(PORTAL_APROVACAO_TOUR_ID)).toBe(false);
  });

  it("grava visto com markTourSeen", () => {
    markTourSeen(PORTAL_APROVACAO_TOUR_ID);
    expect(hasSeenPortalAprovacaoTour()).toBe(true);
    expect(localStorage.getItem(tourSeenStorageKey(PORTAL_APROVACAO_TOUR_ID))).toBe(
      "1",
    );
  });

  it("complete grava visto e stop não grava", () => {
    useGuidedTourStore.getState().start(PORTAL_APROVACAO_TOUR_ID);
    useGuidedTourStore.getState().stop();
    expect(hasSeenPortalAprovacaoTour()).toBe(false);

    useGuidedTourStore.getState().start(PORTAL_APROVACAO_TOUR_ID);
    useGuidedTourStore.getState().complete();
    expect(hasSeenPortalAprovacaoTour()).toBe(true);
    expect(useGuidedTourStore.getState().tourId).toBeNull();
  });

  it("complete da primeira parte não marca o tour de alterações", () => {
    useGuidedTourStore.getState().start(PORTAL_APROVACAO_TOUR_ID);
    useGuidedTourStore.getState().complete();
    expect(hasSeenPortalAprovacaoTour()).toBe(true);
    expect(hasSeenPortalAprovacaoAlteracoesTour()).toBe(false);

    useGuidedTourStore.getState().start(PORTAL_APROVACAO_ALTERACOES_TOUR_ID);
    useGuidedTourStore.getState().complete();
    expect(hasSeenPortalAprovacaoAlteracoesTour()).toBe(true);
  });
});
