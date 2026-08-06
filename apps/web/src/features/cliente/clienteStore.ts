import { create } from "zustand";

import {
  clienteLogin,
  clienteLogout,
  fetchClienteMe,
  type ClienteUser,
} from "@/api/cliente-portal";

interface ClienteAuthState {
  user: ClienteUser | null;
  isAuthenticated: boolean;
  isHydrating: boolean;
  isSubmitting: boolean;
  error: string | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  hydrate: () => Promise<void>;
  clearError: () => void;
}

let hydrateInFlight: Promise<void> | null = null;

export const useClienteStore = create<ClienteAuthState>((set) => ({
  user: null,
  isAuthenticated: false,
  isHydrating: false,
  isSubmitting: false,
  error: null,

  clearError: () => set({ error: null }),

  login: async (email, password) => {
    set({ isSubmitting: true, error: null });
    try {
      const { user } = await clienteLogin(email, password);
      set({ user, isAuthenticated: true, isSubmitting: false });
    } catch (err) {
      set({
        isSubmitting: false,
        error: err instanceof Error ? err.message : "Falha no login.",
      });
      throw err;
    }
  },

  logout: async () => {
    await clienteLogout().catch(() => undefined);
    set({ user: null, isAuthenticated: false });
  },

  hydrate: async () => {
    if (hydrateInFlight) {
      await hydrateInFlight;
      return;
    }
    set({ isHydrating: true });
    hydrateInFlight = (async () => {
      try {
        const user = await fetchClienteMe();
        set({ user, isAuthenticated: true });
      } catch {
        set({ user: null, isAuthenticated: false });
      } finally {
        set({ isHydrating: false });
        hydrateInFlight = null;
      }
    })();
    await hydrateInFlight;
  },
}));
