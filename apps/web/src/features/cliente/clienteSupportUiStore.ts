import { create } from "zustand";

interface PtOsContext {
  ano: number;
  nrOs: number;
  versao: string | null;
}

interface ClienteSupportUiState {
  modalOpen: boolean;
  ano: number | null;
  nrOs: number | null;
  versao: string | null;
  ticketId: number | null;
  fabContext: PtOsContext | null;
  setFabContext: (ctx: PtOsContext) => void;
  openChat: (params: {
    ano: number;
    nrOs: number;
    versao?: string | null;
    ticketId?: number | null;
  }) => void;
  closeModal: () => void;
}

export const useClienteSupportUiStore = create<ClienteSupportUiState>((set) => ({
  modalOpen: false,
  ano: null,
  nrOs: null,
  versao: null,
  ticketId: null,
  fabContext: null,
  setFabContext: (ctx) => set({ fabContext: ctx }),
  openChat: ({ ano, nrOs, versao = null, ticketId = null }) =>
    set({
      modalOpen: true,
      ano,
      nrOs,
      versao,
      ticketId,
      fabContext: { ano, nrOs, versao },
    }),
  closeModal: () =>
    set({
      modalOpen: false,
      ano: null,
      nrOs: null,
      versao: null,
      ticketId: null,
    }),
}));
