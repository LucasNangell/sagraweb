import { create } from "zustand";

import {
  activateAccount,
  createSession,
  fetchCurrentSession,
  fetchPermissions,
  loginWithPassword,
  logoutSession,
} from "./api";
import {
  createDeniedPermissions,
  hasPermission as checkPermission,
  parsePermissionsFromApi,
} from "./permissions";
import type { PermissionKey, Permissions, SessionUser } from "./types";

interface AuthState {
  user: SessionUser | null;
  permissions: Permissions;
  isAuthenticated: boolean;
  isHydrating: boolean;
  isSubmitting: boolean;
  error: string | null;

  hasPermission: (key: PermissionKey) => boolean;
  login: (ponto: number, nome: string, password?: string) => Promise<void>;
  loginPassword: (login: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  hydrate: () => Promise<void>;
  clearError: () => void;
}

let hydrateInFlight: Promise<void> | null = null;

function applyDenied(state: Partial<AuthState>): Partial<AuthState> {
  return {
    user: null,
    permissions: createDeniedPermissions(),
    isAuthenticated: false,
    ...state,
  };
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  permissions: createDeniedPermissions(),
  isAuthenticated: false,
  /** true até o primeiro hydrate — evita flash de "Acesso negado" nas rotas standalone. */
  isHydrating: true,
  isSubmitting: false,
  error: null,

  hasPermission: (key) => {
    const { isAuthenticated, permissions } = get();
    if (!isAuthenticated) {
      return false;
    }
    return checkPermission(permissions, key);
  },

  clearError: () => set({ error: null }),

  login: async (ponto, nome, password) => {
    set({ isSubmitting: true, error: null });
    try {
      const user = await createSession(ponto, nome, password);
      let permissions = createDeniedPermissions();
      try {
        const raw = await fetchPermissions();
        permissions = parsePermissionsFromApi(raw);
      } catch {
        await logoutSession().catch(() => undefined);
        set(
          applyDenied({
            isSubmitting: false,
            error:
              "Não foi possível carregar permissões. Acesso negado (anti fail-open).",
          }),
        );
        return;
      }

      set({
        user,
        permissions,
        isAuthenticated: true,
        isHydrating: false,
        isSubmitting: false,
        error: null,
      });
    } catch (err) {
      set(
        applyDenied({
          isSubmitting: false,
          error:
            err instanceof Error
              ? err.message
              : "Falha ao autenticar. Verifique ponto e nome.",
        }),
      );
    }
  },

  loginPassword: async (login, password) => {
    set({ isSubmitting: true, error: null });
    try {
      const user = await loginWithPassword(login.trim(), password);
      let permissions = createDeniedPermissions();
      try {
        const raw = await fetchPermissions();
        permissions = parsePermissionsFromApi(raw);
      } catch {
        await logoutSession().catch(() => undefined);
        set(
          applyDenied({
            isSubmitting: false,
            error:
              "Não foi possível carregar permissões. Acesso negado (anti fail-open).",
          }),
        );
        return;
      }

      set({
        user,
        permissions,
        isAuthenticated: true,
        isHydrating: false,
        isSubmitting: false,
        error: null,
      });
    } catch (err) {
      set(
        applyDenied({
          isSubmitting: false,
          error:
            err instanceof Error
              ? err.message
              : "Falha ao autenticar. Verifique usuário e senha.",
        }),
      );
    }
  },

  logout: async () => {
    try {
      await logoutSession();
    } catch {
      /* cookie limpo no cliente mesmo se a API falhar */
    }
    set(applyDenied({ isHydrating: false, error: null }));
  },

  hydrate: async () => {
    if (hydrateInFlight) {
      return hydrateInFlight;
    }

    hydrateInFlight = (async () => {
      set({ isHydrating: true });
      try {
        const me = await fetchCurrentSession();
        if (!me) {
          set(applyDenied({ isHydrating: false }));
          return;
        }

        const user: SessionUser = {
          ponto: me.ponto,
          nome: me.nome,
          ip: me.ip,
          auth_mode: me.auth_mode,
          setor: me.setor ?? null,
          fornecedor: Boolean(me.fornecedor),
        };

        try {
          const raw = await fetchPermissions();
          set({
            user,
            permissions: parsePermissionsFromApi(raw),
            isAuthenticated: true,
            isHydrating: false,
            error: null,
          });
        } catch {
          await logoutSession().catch(() => undefined);
          set(
            applyDenied({
              isHydrating: false,
              error: "Sessão encerrada: permissões indisponíveis.",
            }),
          );
        }
      } catch {
        set(applyDenied({ isHydrating: false }));
      }
    })();

    try {
      await hydrateInFlight;
    } finally {
      hydrateInFlight = null;
    }
  },
}));
