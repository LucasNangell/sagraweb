import { ANDAMENTOS_TOUR_ID, ANDAMENTOS_TOUR_TITLE, andamentosTour } from "./tours/andamentos";
import {
  PORTAL_APROVACAO_ALTERACOES_TOUR_ID,
  PORTAL_APROVACAO_TOUR_ID,
  portalAprovacaoAlteracoesTour,
  portalAprovacaoTour,
} from "./tours/portalAprovacao";
import type { GuidedTour, TourCatalogItem } from "./types";

const TOURS: Record<string, GuidedTour> = {
  [ANDAMENTOS_TOUR_ID]: andamentosTour,
  [PORTAL_APROVACAO_TOUR_ID]: portalAprovacaoTour,
  [PORTAL_APROVACAO_ALTERACOES_TOUR_ID]: portalAprovacaoAlteracoesTour,
};

export const TOUR_CATALOG: TourCatalogItem[] = [
  { id: ANDAMENTOS_TOUR_ID, title: ANDAMENTOS_TOUR_TITLE },
];

export function getTour(id: string): GuidedTour | undefined {
  return TOURS[id];
}

export function getTourCatalog(): TourCatalogItem[] {
  return TOUR_CATALOG;
}
