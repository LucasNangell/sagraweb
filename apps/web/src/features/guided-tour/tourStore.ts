import { create } from "zustand";

import { getTour } from "./catalog";
import type { TourMobileView } from "./types";

interface GuidedTourState {
  tourId: string | null;
  stepIndex: number;
  requestedMobileView: TourMobileView | null;
  start: (tourId: string) => void;
  next: () => void;
  stop: () => void;
}

export const useGuidedTourStore = create<GuidedTourState>((set, get) => ({
  tourId: null,
  stepIndex: 0,
  requestedMobileView: null,
  start: (tourId) => {
    const tour = getTour(tourId);
    if (!tour || tour.steps.length === 0) {
      return;
    }
    const first = tour.steps[0];
    first?.beforeShow?.();
    set({
      tourId,
      stepIndex: 0,
      requestedMobileView: first?.mobileView ?? null,
    });
  },
  next: () => {
    const { tourId, stepIndex } = get();
    const tour = tourId ? getTour(tourId) : undefined;
    if (!tour) {
      set({ tourId: null, stepIndex: 0, requestedMobileView: null });
      return;
    }
    const nextIndex = stepIndex + 1;
    if (nextIndex >= tour.steps.length) {
      set({ tourId: null, stepIndex: 0, requestedMobileView: null });
      return;
    }
    const step = tour.steps[nextIndex];
    step?.beforeShow?.();
    set({
      stepIndex: nextIndex,
      requestedMobileView: step?.mobileView ?? null,
    });
  },
  stop: () =>
    set({ tourId: null, stepIndex: 0, requestedMobileView: null }),
}));
