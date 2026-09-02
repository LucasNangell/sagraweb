import { create } from "zustand";

import { getTour } from "./catalog";
import { markTourSeen } from "./tourSeen";
import type { TourMobileView } from "./types";

interface GuidedTourState {
  tourId: string | null;
  stepIndex: number;
  requestedMobileView: TourMobileView | null;
  start: (tourId: string) => void;
  next: () => void;
  stop: () => void;
  complete: () => void;
}

const idleState = {
  tourId: null as string | null,
  stepIndex: 0,
  requestedMobileView: null as TourMobileView | null,
};

export const useGuidedTourStore = create<GuidedTourState>((set, get) => ({
  ...idleState,
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
    const { tourId, stepIndex, complete } = get();
    const tour = tourId ? getTour(tourId) : undefined;
    if (!tour) {
      set(idleState);
      return;
    }
    const nextIndex = stepIndex + 1;
    if (nextIndex >= tour.steps.length) {
      complete();
      return;
    }
    const step = tour.steps[nextIndex];
    step?.beforeShow?.();
    set({
      stepIndex: nextIndex,
      requestedMobileView: step?.mobileView ?? null,
    });
  },
  stop: () => set(idleState),
  complete: () => {
    const { tourId } = get();
    if (tourId) {
      markTourSeen(tourId);
    }
    set(idleState);
  },
}));
