/**
 * Mantém a sessão viva enquanto o sistema estiver aberto.
 *
 * - Heartbeat periódico em GET /api/auth/me (o backend renova o cookie — sliding).
 * - Revalida ao voltar para a aba e quando a rede volta.
 * - Ao detectar sessão inválida/IP divergente (via apiFetch ou heartbeat),
 *   tenta reconectar sem recarregar a página. No modo local (ponto, sem senha)
 *   refaz o login automaticamente — mesmas validações da tela de login.
 *   Se não for possível, abre o diálogo de reautenticação mantendo a tela atual.
 */
import { queryClient } from "@/lib/query-client";
import {
  onSessionProblem,
  type SessionProblemCode,
  SESSION_ERROR_IP_MISMATCH,
} from "@/lib/sessionEvents";

import { createSession, fetchCurrentSession, fetchPermissions } from "./api";
import { useAuthStore } from "./authStore";
import { parsePermissionsFromApi } from "./permissions";
import type { SessionUser } from "./types";

export const SESSION_HEARTBEAT_MS = 5 * 60_000;
/** Evita revalidar a cada troca rápida de aba. */
const VISIBILITY_MIN_INTERVAL_MS = 30_000;

let recoveryInFlight: Promise<boolean> | null = null;
let lastCheckAt = 0;

class TransientSessionCheckError extends Error {}

async function readCurrentSession() {
  try {
    return await fetchCurrentSession();
  } catch {
    // Rede/servidor indisponível — não é perda de sessão.
    throw new TransientSessionCheckError();
  }
}

async function onSessionRestored(user?: SessionUser): Promise<void> {
  const patch: Partial<ReturnType<typeof useAuthStore.getState>> = {
    sessionStatus: "ok",
    sessionError: null,
  };
  if (user) patch.user = user;
  try {
    patch.permissions = parsePermissionsFromApi(await fetchPermissions());
  } catch {
    /* mantém permissões já carregadas */
  }
  useAuthStore.setState(patch);
  await queryClient.invalidateQueries();
}

/** Chamado pelo diálogo de reautenticação após login bem-sucedido. */
export function completeReauthentication(user: SessionUser): Promise<void> {
  return onSessionRestored(user);
}

async function trySilentLocalLogin(user: SessionUser): Promise<SessionUser | null> {
  if (user.auth_mode && user.auth_mode !== "local") return null;
  if (!user.ponto || !user.nome) return null;
  try {
    return await createSession(user.ponto, user.nome);
  } catch (err) {
    useAuthStore.setState({
      sessionError: err instanceof Error ? err.message : null,
    });
    return null;
  }
}

/**
 * Tenta recuperar a sessão sem recarregar a página.
 * Retorna true se a sessão está válida ao final.
 */
export function recoverSession(reason?: SessionProblemCode): Promise<boolean> {
  if (recoveryInFlight) return recoveryInFlight;

  recoveryInFlight = (async () => {
    const state = useAuthStore.getState();
    if (!state.isAuthenticated || !state.user) return false;
    if (state.sessionStatus === "expired") return false;

    useAuthStore.setState({ sessionStatus: "recovering" });
    try {
      const me = await readCurrentSession();
      const ipOk = me?.ip_matches !== false;
      if (me && ipOk && reason !== SESSION_ERROR_IP_MISMATCH) {
        // Sessão válida (falha pontual) — apenas recarrega os dados.
        await onSessionRestored();
        return true;
      }

      const renewed = await trySilentLocalLogin(state.user);
      if (renewed) {
        await onSessionRestored(renewed);
        return true;
      }

      useAuthStore.setState({ sessionStatus: "expired" });
      return false;
    } catch (err) {
      if (err instanceof TransientSessionCheckError) {
        // Sem conexão: volta ao normal; queries tentam de novo sozinhas.
        useAuthStore.setState({ sessionStatus: "ok" });
        return false;
      }
      useAuthStore.setState({ sessionStatus: "expired" });
      return false;
    } finally {
      lastCheckAt = Date.now();
    }
  })();

  return recoveryInFlight.finally(() => {
    recoveryInFlight = null;
  });
}

/** Heartbeat: renova o cookie e detecta sessão perdida antes do usuário perceber. */
export async function checkSessionAlive(): Promise<void> {
  const state = useAuthStore.getState();
  if (!state.isAuthenticated || state.sessionStatus !== "ok") return;
  lastCheckAt = Date.now();
  let me;
  try {
    me = await readCurrentSession();
  } catch {
    return;
  }
  if (!me) {
    await recoverSession();
  } else if (me.ip_matches === false) {
    await recoverSession(SESSION_ERROR_IP_MISMATCH);
  }
}

/** Inicia heartbeat + listeners. Retorna função de limpeza. */
export function startSessionKeeper(): () => void {
  const unsubscribe = onSessionProblem((code) => {
    void recoverSession(code);
  });

  const interval = window.setInterval(() => {
    void checkSessionAlive();
  }, SESSION_HEARTBEAT_MS);

  const onVisible = () => {
    if (document.visibilityState !== "visible") return;
    if (Date.now() - lastCheckAt < VISIBILITY_MIN_INTERVAL_MS) return;
    void checkSessionAlive();
  };
  const onOnline = () => {
    void checkSessionAlive().then(() => queryClient.invalidateQueries());
  };

  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("online", onOnline);

  return () => {
    unsubscribe();
    window.clearInterval(interval);
    document.removeEventListener("visibilitychange", onVisible);
    window.removeEventListener("online", onOnline);
  };
}
