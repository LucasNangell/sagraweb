import { Loader2, ShieldAlert } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";

import { createSession, loginWithPassword } from "@/features/auth/api";
import { useAuthStore } from "@/features/auth/authStore";
import {
  completeReauthentication,
  recoverSession,
  startSessionKeeper,
} from "@/features/auth/sessionKeeper";

const INPUT_CLASS =
  "w-full rounded-md border border-sagra-border px-3 py-2 text-sm outline-none focus:border-primary-green focus:ring-1 focus:ring-primary-green";

/**
 * Mantém a sessão viva (heartbeat) e, se ela for perdida, reconecta sem
 * recarregar a página. Quando a reconexão automática não é possível, pede
 * novo login num diálogo sobre a tela atual (nada do que está aberto se perde).
 */
export function SessionRecoveryOverlay() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const sessionStatus = useAuthStore((s) => s.sessionStatus);

  useEffect(() => {
    if (!isAuthenticated) return undefined;
    return startSessionKeeper();
  }, [isAuthenticated]);

  if (!isAuthenticated) return null;

  if (sessionStatus === "recovering") {
    return (
      <div
        role="status"
        className="fixed bottom-4 left-1/2 z-[9998] flex -translate-x-1/2 items-center gap-2 rounded-full bg-secondary-blue px-4 py-2 text-sm text-white shadow-lg"
      >
        <Loader2 className="size-4 animate-spin" aria-hidden />
        Reconectando sua sessão…
      </div>
    );
  }

  if (sessionStatus === "expired") {
    return <SessionExpiredDialog />;
  }

  return null;
}

function SessionExpiredDialog() {
  const user = useAuthStore((s) => s.user);
  const sessionError = useAuthStore((s) => s.sessionError);
  const logout = useAuthStore((s) => s.logout);
  const isPasswordMode = user?.auth_mode === "password";

  const [login, setLogin] = useState(() => (user?.ponto ? String(user.ponto) : ""));
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(sessionError);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!user) return;
    setSubmitting(true);
    setError(null);
    try {
      const renewed = isPasswordMode
        ? await loginWithPassword(login.trim(), password)
        : await createSession(user.ponto, user.nome, password.trim() || undefined);
      await completeReauthentication(renewed);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Não foi possível entrar. Confira os dados e tente novamente.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const onRetry = async () => {
    setSubmitting(true);
    setError(null);
    useAuthStore.setState({ sessionStatus: "ok" });
    const ok = await recoverSession();
    if (!ok && useAuthStore.getState().sessionStatus !== "expired") {
      setError("Servidor inacessível no momento. Verifique a rede e tente novamente.");
      useAuthStore.setState({ sessionStatus: "expired" });
    }
    setSubmitting(false);
  };

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="session-expired-title"
    >
      <div className="w-full max-w-sm rounded-lg border-t-4 border-amber-500 bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-start gap-3">
          <ShieldAlert className="mt-0.5 size-6 shrink-0 text-amber-600" aria-hidden />
          <div>
            <h2 id="session-expired-title" className="text-lg font-semibold text-secondary-blue">
              Sessão expirada
            </h2>
            <p className="mt-1 text-sm text-neutral-600">
              Não foi possível reconectar automaticamente. Entre novamente para
              continuar — a tela atual e o que você estava fazendo serão mantidos.
            </p>
          </div>
        </div>

        <form onSubmit={(e) => void onSubmit(e)} className="space-y-3">
          {isPasswordMode ? (
            <div>
              <label htmlFor="reauth-login" className="mb-1 block text-sm font-medium text-sagra-text">
                E-mail ou ponto
              </label>
              <input
                id="reauth-login"
                type="text"
                autoComplete="username"
                className={INPUT_CLASS}
                value={login}
                onChange={(e) => setLogin(e.target.value)}
              />
            </div>
          ) : (
            <p className="rounded-md bg-neutral-50 px-3 py-2 text-sm text-sagra-text">
              <span className="font-medium">P_{user?.ponto}</span> — {user?.nome}
            </p>
          )}

          <div>
            <label htmlFor="reauth-password" className="mb-1 block text-sm font-medium text-sagra-text">
              Senha{isPasswordMode ? "" : " (se exigida para este computador)"}
            </label>
            <input
              id="reauth-password"
              type="password"
              autoComplete="current-password"
              autoFocus
              className={INPUT_CLASS}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          {error ? (
            <div
              role="alert"
              className="rounded-md border border-sagra-danger/30 bg-red-50 px-3 py-2 text-sm text-sagra-danger"
            >
              {error}
            </div>
          ) : null}

          <button
            type="submit"
            disabled={submitting || (isPasswordMode && (!login.trim() || !password))}
            className="sagra-btn sagra-btn--primary sagra-btn--md w-full"
          >
            {submitting ? <Loader2 className="size-4 animate-spin" /> : null}
            Entrar e continuar
          </button>
        </form>

        <div className="mt-3 flex justify-between gap-2 text-xs">
          <button
            type="button"
            className="text-secondary-blue hover:underline disabled:opacity-50"
            disabled={submitting}
            onClick={() => void onRetry()}
          >
            Tentar reconectar
          </button>
          <button
            type="button"
            className="text-neutral-500 hover:underline"
            onClick={() => void logout()}
          >
            Sair e ir para a tela de login
          </button>
        </div>
      </div>
    </div>
  );
}
