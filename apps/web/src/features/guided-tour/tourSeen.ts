export const PORTAL_APROVACAO_TOUR_ID = "portal-aprovacao";
export const PORTAL_APROVACAO_ALTERACOES_TOUR_ID = "portal-aprovacao-alteracoes";

export function tourSeenStorageKey(tourId: string): string {
  return `sagra.tour.${tourId}.seen`;
}

export function hasSeenTour(tourId: string): boolean {
  if (typeof localStorage === "undefined") {
    return false;
  }
  try {
    return localStorage.getItem(tourSeenStorageKey(tourId)) === "1";
  } catch {
    return false;
  }
}

export function markTourSeen(tourId: string): void {
  if (typeof localStorage === "undefined") {
    return;
  }
  try {
    localStorage.setItem(tourSeenStorageKey(tourId), "1");
  } catch {
    /* private mode / quota */
  }
}

export function hasSeenPortalAprovacaoTour(): boolean {
  return hasSeenTour(PORTAL_APROVACAO_TOUR_ID);
}

export function hasSeenPortalAprovacaoAlteracoesTour(): boolean {
  return hasSeenTour(PORTAL_APROVACAO_ALTERACOES_TOUR_ID);
}
