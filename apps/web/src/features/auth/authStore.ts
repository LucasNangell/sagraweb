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

/** ok = normal; recovering = reconectando em segundo plano; expired = pedir novo login (sem sair da tela). */
export type SessionStatus = "ok" | "recovering" | "expired";

interface AuthState {
  user: SessionUser | null;
  sessionStatus: SessionStatus;
  /** Motivo da última falha de reconexão (exibido no diálogo). */
  sessionError: string | null;
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

const HYDRATE_RETRY_DELAYS_MS = [1_000, 3_000, 6_000];

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** /auth/me com novas tentativas em falha de rede/servidor (não em 401/403). */
async function fetchCurrentSessionWithRetry() {
  let lastError: unknown;
  for (let attempt = 0; attempt <= HYDRATE_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      return await fetchCurrentSession();
    } catch (err) {
      lastError = err;
      const wait = HYDRATE_RETRY_DELAYS_MS[attempt];
      if (wait === undefined) break;
      await delay(wait);
    }
  }
  throw lastError;
}

async function fetchPermissionsWithRetry() {
  try {
    return await fetchPermissions();
  } catch {
    await delay(1_500);
    return fetchPermissions();
  }
}

function applyDenied(state: Partial<AuthState>): Partial<AuthState> {
  return {
    user: null,
    permissions: createDeniedPermissions(),
    isAuthenticated: false,
    sessionStatus: "ok",
    sessionError: null,
    ...state,
  };
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  sessionStatus: "ok",
  sessionError: null,
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
        sessionStatus: "ok",
        sessionError: null,
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
        sessionStatus: "ok",
        sessionError: null,
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
        let me;
        try {
          me = await fetchCurrentSessionWithRetry();
        } catch {
          // Servidor inacessível: não apaga o cookie; usuário pode tentar de novo.
          set(
            applyDenied({
              isHydrating: false,
              error:
                "Não foi possível conectar ao servidor do SAGRA para validar a sessão. Verifique a rede e tente novamente.",
            }),
          );
          return;
        }
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
          const raw = await fetchPermissionsWithRetry();
          set({
            user,
            permissions: parsePermissionsFromApi(raw),
            isAuthenticated: true,
            isHydrating: false,
            error: null,
            sessionStatus: "ok",
            sessionError: null,
          });
        } catch {
          // Anti fail-open: sem permissões não entra — mas NÃO derruba o cookie
          // (falha pode ser transitória; recarregar a página resolve sem novo login).
          set(
            applyDenied({
              isHydrating: false,
              error:
                "Não foi possível carregar suas permissões no momento. Tente novamente em instantes.",
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
