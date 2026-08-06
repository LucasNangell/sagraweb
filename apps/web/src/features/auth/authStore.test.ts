import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./api", () => ({
  createSession: vi.fn(),
  loginWithPassword: vi.fn(),
  fetchCurrentSession: vi.fn(),
  fetchPermissions: vi.fn(),
  logoutSession: vi.fn(),
}));

import * as authApi from "./api";
import { useAuthStore } from "./authStore";
import { createDeniedPermissions } from "./permissions";

function resetStore() {
  useAuthStore.setState({
    user: null,
    permissions: createDeniedPermissions(),
    isAuthenticated: false,
    isHydrating: false,
    isSubmitting: false,
    error: null,
  });
}

describe("authStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStore();
  });

  afterEach(() => {
    resetStore();
  });

  it("estado inicial seguro — não autenticado e permissões negadas", () => {
    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(false);
    expect(state.user).toBeNull();
    expect(state.hasPermission("sb_analise")).toBe(false);
  });

  it("logout limpa sessão local mesmo se API falhar", async () => {
    useAuthStore.setState({
      isAuthenticated: true,
      user: { ponto: 1, nome: "U", ip: "127.0.0.1" },
    });
    vi.mocked(authApi.logoutSession).mockRejectedValue(new Error("offline"));

    await useAuthStore.getState().logout();

    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(false);
    expect(state.user).toBeNull();
  });

  it("hydrate com /me 401 não mantém usuário logado", async () => {
    vi.mocked(authApi.fetchCurrentSession).mockResolvedValue(null);

    await useAuthStore.getState().hydrate();

    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(false);
    expect(state.user).toBeNull();
    expect(state.isHydrating).toBe(false);
  });

  it("login falha ao carregar permissões — fail-closed", async () => {
    vi.mocked(authApi.createSession).mockResolvedValue({
      ponto: 1,
      nome: "Test",
      ip: "127.0.0.1",
    });
    vi.mocked(authApi.fetchPermissions).mockRejectedValue(new Error("403"));
    vi.mocked(authApi.logoutSession).mockResolvedValue(undefined);

    await useAuthStore.getState().login(1, "Test");

    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(false);
    expect(state.error).toMatch(/permissões/i);
    expect(authApi.logoutSession).toHaveBeenCalled();
  });
});
