import { create } from "zustand";

import { apiFetch, ApiError } from "@/lib/http";

export interface SessionUser {
  ponto: number;
  nome: string;
  ip?: string;
  auth_mode?: string;
  setor?: string | null;
  fornecedor?: boolean;
}

export interface Permissions {
  sb_dashboard_tablet?: boolean;
  sb_dashboard_setor?: boolean;
  sb_dashboard_global?: boolean;
  painel_setores?: string[];
  painel_setores_legacy_all?: boolean;
  [key: string]: unknown;
}

interface AuthState {
  hydrated: boolean;
  isAuthenticated: boolean;
  user: SessionUser | null;
  permissions: Permissions;
  error: string | null;
  hydrate: () => Promise<void>;
  loginPassword: (login: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

function emptyPermissions(): Permissions {
  return {
    sb_dashboard_tablet: false,
    painel_setores: [],
    painel_setores_legacy_all: false,
  };
}

export const useAuthStore = create<AuthState>((set) => ({
  hydrated: false,
  isAuthenticated: false,
  user: null,
  permissions: emptyPermissions(),
  error: null,

  hydrate: async () => {
    try {
      const me = await apiFetch<SessionUser>("/auth/me");
      if (!me?.ponto) {
        set({
          hydrated: true,
          isAuthenticated: false,
          user: null,
          permissions: emptyPermissions(),
        });
        return;
      }
      let permissions = emptyPermissions();
      try {
        permissions = await apiFetch<Permissions>("/permissions");
      } catch {
        /* keep empty */
      }
      set({
        hydrated: true,
        isAuthenticated: true,
        user: me,
        permissions,
        error: null,
      });
    } catch (err) {
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
        set({
          hydrated: true,
          isAuthenticated: false,
          user: null,
          permissions: emptyPermissions(),
        });
        return;
      }
      set({
        hydrated: true,
        isAuthenticated: false,
        user: null,
        permissions: emptyPermissions(),
        error: err instanceof Error ? err.message : "Falha ao validar sessão",
      });
    }
  },

  loginPassword: async (login, password) => {
    set({ error: null });
    const res = await apiFetch<{ user?: SessionUser }>("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ login: login.trim(), password }),
    });
    const permissions = await apiFetch<Permissions>("/permissions");
    const user =
      res.user ??
      (await apiFetch<SessionUser>("/auth/me").catch(() => null));
    if (!user) {
      throw new Error("Login ok, mas sessão não disponível.");
    }
    set({
      hydrated: true,
      isAuthenticated: true,
      user,
      permissions,
      error: null,
    });
  },

  logout: async () => {
    try {
      await apiFetch("/auth/logout", { method: "POST" });
    } catch {
      /* ignore */
    }
    set({
      isAuthenticated: false,
      user: null,
      permissions: emptyPermissions(),
      error: null,
    });
  },
}));

export function canUseTablet(permissions: Permissions): boolean {
  return Boolean(permissions.sb_dashboard_tablet);
}

export function allowedPainelSetores(
  permissions: Permissions,
  userSetor?: string | null,
): string[] {
  if (permissions.painel_setores_legacy_all) {
    return userSetor ? [userSetor] : [];
  }
  const list = (permissions.painel_setores ?? []).filter(Boolean);
  if (list.length > 0) return list;
  if (userSetor) return [userSetor];
  return [];
}
