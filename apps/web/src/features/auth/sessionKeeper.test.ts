import { beforeEach, describe, expect, it, vi } from "vitest";

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
import { checkSessionAlive, recoverSession } from "./sessionKeeper";
import { queryClient } from "@/lib/query-client";
import { SESSION_ERROR_IP_MISMATCH } from "@/lib/sessionEvents";

const localUser = { ponto: 918713, nome: "Teste", ip: "10.0.0.1", auth_mode: "local" };

function loggedIn(overrides: Record<string, unknown> = {}) {
  useAuthStore.setState({
    user: { ...localUser, ...overrides },
    permissions: createDeniedPermissions(),
    isAuthenticated: true,
    isHydrating: false,
    sessionStatus: "ok",
    sessionError: null,
  });
}

describe("sessionKeeper", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(authApi.fetchPermissions).mockResolvedValue({} as never);
    vi.spyOn(queryClient, "invalidateQueries").mockResolvedValue();
    loggedIn();
  });

  it("sessão ainda válida: só recarrega os dados, sem novo login", async () => {
    vi.mocked(authApi.fetchCurrentSession).mockResolvedValue({ ...localUser, ip_matches: true });

    await expect(recoverSession()).resolves.toBe(true);

    expect(authApi.createSession).not.toHaveBeenCalled();
    expect(queryClient.invalidateQueries).toHaveBeenCalled();
    expect(useAuthStore.getState().sessionStatus).toBe("ok");
  });

  it("sessão perdida no modo local: reloga silenciosamente sem sair da tela", async () => {
    vi.mocked(authApi.fetchCurrentSession).mockResolvedValue(null);
    vi.mocked(authApi.createSession).mockResolvedValue({ ...localUser, ip: "10.0.0.2" });

    await expect(recoverSession()).resolves.toBe(true);

    expect(authApi.createSession).toHaveBeenCalledWith(918713, "Teste");
    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(true);
    expect(state.sessionStatus).toBe("ok");
    expect(state.user?.ip).toBe("10.0.0.2");
  });

  it("IP divergente força novo vínculo mesmo com cookie válido", async () => {
    vi.mocked(authApi.fetchCurrentSession).mockResolvedValue({ ...localUser, ip_matches: false });
    vi.mocked(authApi.createSession).mockResolvedValue(localUser);

    await recoverSession(SESSION_ERROR_IP_MISMATCH);

    expect(authApi.createSession).toHaveBeenCalled();
    expect(useAuthStore.getState().sessionStatus).toBe("ok");
  });

  it("senha exigida: abre diálogo (expired) mantendo usuário autenticado na tela", async () => {
    vi.mocked(authApi.fetchCurrentSession).mockResolvedValue(null);
    vi.mocked(authApi.createSession).mockRejectedValue(new Error("Senha obrigatória"));

    await expect(recoverSession()).resolves.toBe(false);

    const state = useAuthStore.getState();
    expect(state.sessionStatus).toBe("expired");
    expect(state.sessionError).toBe("Senha obrigatória");
    expect(state.isAuthenticated).toBe(true);
  });

  it("modo senha (internet) não tenta login silencioso", async () => {
    loggedIn({ auth_mode: "password" });
    vi.mocked(authApi.fetchCurrentSession).mockResolvedValue(null);

    await recoverSession();

    expect(authApi.createSession).not.toHaveBeenCalled();
    expect(useAuthStore.getState().sessionStatus).toBe("expired");
  });

  it("servidor fora do ar não é tratado como sessão perdida", async () => {
    vi.mocked(authApi.fetchCurrentSession).mockRejectedValue(new Error("offline"));

    await recoverSession();

    expect(useAuthStore.getState().sessionStatus).toBe("ok");
    expect(authApi.createSession).not.toHaveBeenCalled();
  });

  it("heartbeat com sessão válida não dispara recuperação", async () => {
    vi.mocked(authApi.fetchCurrentSession).mockResolvedValue({ ...localUser, ip_matches: true });

    await checkSessionAlive();

    expect(authApi.createSession).not.toHaveBeenCalled();
    expect(queryClient.invalidateQueries).not.toHaveBeenCalled();
  });
});
