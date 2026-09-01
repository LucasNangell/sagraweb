import type { OsSearchRow } from "@/features/os/types";

export type TourPlacement = "top" | "bottom" | "left" | "right" | "center";

export type TourAdvance = "next" | "wait";

export type TourMobileView = "list" | "details" | "history";

export interface TourStepContext {
  selectedOs: OsSearchRow | null;
}

export interface TourStep {
  id: string;
  title: string;
  body: string;
  /** Valor de `data-tour` no alvo. Omitir para balão centralizado. */
  target?: string;
  placement?: TourPlacement;
  advance: TourAdvance;
  skipIfMissingTarget?: boolean;
  shouldSkip?: () => boolean;
  waitingBody?: (ctx: TourStepContext) => string | null;
  waitUntil?: (ctx: TourStepContext) => boolean;
  beforeShow?: () => void;
  mobileView?: TourMobileView;
}

export interface GuidedTour {
  id: string;
  title: string;
  steps: TourStep[];
}

export interface TourCatalogItem {
  id: string;
  title: string;
}
