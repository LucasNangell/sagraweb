import { create } from "zustand";



export type SupportModalKind = "internal" | "assigned";



export type SupportViewingScope = "usuario" | "admin" | "assigned";



interface SupportUiState {

  modalOpen: boolean;

  initialTicketId: number | null;

  modalKind: SupportModalKind;

  viewingTickets: Record<SupportViewingScope, number | null>;

  openModal: (ticketId?: number, kind?: SupportModalKind) => void;

  closeModal: () => void;

  setViewingTicket: (scope: SupportViewingScope, ticketId: number | null) => void;

}



export function shouldSuppressSupportNotification(

  detalhes: { type?: string; ticket_id?: number; support_message_id?: number } | null,

): boolean {

  if (!detalhes?.type) {

    return false;

  }

  const ticketId = detalhes.ticket_id ?? detalhes.support_message_id;

  if (!ticketId) {

    return false;

  }

  const viewing = useSupportUiStore.getState().viewingTickets;

  if (detalhes.type === "support_reply" && viewing.usuario === ticketId) {

    return true;

  }

  if (detalhes.type === "support_incoming" && viewing.admin === ticketId) {

    return true;

  }

  if (detalhes.type === "cliente_support" && viewing.assigned === ticketId) {

    return true;

  }

  return false;

}



export const useSupportUiStore = create<SupportUiState>((set) => ({

  modalOpen: false,

  initialTicketId: null,

  modalKind: "internal",

  viewingTickets: {

    usuario: null,

    admin: null,

    assigned: null,

  },

  openModal: (ticketId, kind = "internal") =>

    set({

      modalOpen: true,

      initialTicketId: ticketId ?? null,

      modalKind: kind,

    }),

  closeModal: () =>

    set((state) => ({

      modalOpen: false,

      initialTicketId: null,

      modalKind: "internal",

      viewingTickets: {

        ...state.viewingTickets,

        usuario: null,

        assigned: null,

      },

    })),

  setViewingTicket: (scope, ticketId) =>

    set((state) => ({

      viewingTickets: {

        ...state.viewingTickets,

        [scope]: ticketId,

      },

    })),

}));


