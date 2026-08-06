import { create } from "zustand";

interface GravacaoExternaUiState {
  /** OS cuja conversa de Gravação Externa está aberta na tela. */
  viewingOs: { ano: number; nrOs: number } | null;
  setViewingOs: (ano: number | null, nrOs: number | null) => void;
}

export const useGravacaoExternaUiStore = create<GravacaoExternaUiState>((set) => ({
  viewingOs: null,
  setViewingOs: (ano, nrOs) =>
    set({
      viewingOs: ano != null && nrOs != null ? { ano, nrOs } : null,
    }),
}));

export function matchesViewingGravacaoExternaOs(
  ano: number | null | undefined,
  nrOs: number | null | undefined,
): boolean {
  const viewing = useGravacaoExternaUiStore.getState().viewingOs;
  if (!viewing || ano == null || nrOs == null) {
    return false;
  }
  return viewing.ano === Number(ano) && viewing.nrOs === Number(nrOs);
}

export function shouldSuppressGravacaoExternaNotification(
  detalhes: {
    tipo?: string;
    os_ano?: number;
    os_nro?: number;
  } | null,
): boolean {
  if (detalhes?.tipo !== "gravacao_externa_mensagem") {
    return false;
  }
  return matchesViewingGravacaoExternaOs(detalhes.os_ano, detalhes.os_nro);
}
