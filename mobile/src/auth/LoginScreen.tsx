import { Loader2, LogIn } from "lucide-react";
import { FormEvent, useState } from "react";

import { ApiError } from "@/lib/http";

import { useAuthStore } from "./authStore";

export function LoginScreen() {
  const loginPassword = useAuthStore((s) => s.loginPassword);
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await loginPassword(login, password);
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.detail
          : err instanceof Error
            ? err.message
            : "Falha no login";
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={onSubmit}>
        <div className="login-brand">
          <span className="login-logo">SAGRA</span>
          <h1>Painel Tablet</h1>
          <p>Entre com ponto ou e-mail e senha</p>
        </div>

        <label className="field">
          <span>Ponto ou e-mail</span>
          <input
            autoComplete="username"
            inputMode="email"
            value={login}
            onChange={(e) => setLogin(e.target.value)}
            required
            disabled={busy}
            placeholder="918713 ou nome@camara.leg.br"
          />
        </label>

        <label className="field">
          <span>Senha</span>
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            disabled={busy}
            placeholder="••••••••"
          />
        </label>

        {error ? <div className="alert-error">{error}</div> : null}

        <button type="submit" className="btn-primary" disabled={busy}>
          {busy ? <Loader2 className="spin" size={20} /> : <LogIn size={20} />}
          Entrar
        </button>

        <p className="login-hint">
          Acesso via internet pública. Contas só com ponto+nome da LAN precisam
          ativar a senha pelo e-mail antes.
        </p>
      </form>
    </div>
  );
}
