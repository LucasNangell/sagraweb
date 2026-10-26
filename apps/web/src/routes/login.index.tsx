import { zodResolver } from "@hookform/resolvers/zod";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";

import { fetchUserNameByPonto } from "@/features/auth/api";
import { loginSchema, type LoginFormValues } from "@/features/auth/loginSchema";
import {
  passwordLoginSchema,
  type PasswordLoginFormValues,
} from "@/features/auth/passwordLoginSchema";
import { resolveDefaultAppRoute } from "@/components/layout/nav-config";
import { PainelOsPwaHead } from "@/components/pwa/PainelOsPwaHead";
import { getPainelOsInstallVariant } from "@/components/pwa/usePainelOsManifest";
import { useAuthStore } from "@/features/auth/authStore";
import { apiUrl } from "@/lib/api";
import { sanitizePontoDigits } from "@/lib/format";
import { isPublicWebHostname } from "@/lib/publicHost";
import { normalizeAppRedirect } from "@/lib/normalizeRedirect";

const PONTO_HINT = "Informe somente números do ponto, sem letras, pontos ou traços.";
const LOGIN_HINT = "Use o e-mail cadastrado ou o ponto numérico.";

export const Route = createFileRoute("/login/")({
  validateSearch: (search: Record<string, unknown>) => ({
    redirect: normalizeAppRedirect(
      typeof search.redirect === "string" ? search.redirect : undefined,
    ),
  }),
  component: LoginPage,
});

function useAuthMode(): "ponto" | "password" | null {
  const [mode, setMode] = useState<"ponto" | "password" | null>(null);

  useEffect(() => {
    const preferPassword = isPublicWebHostname();

    void fetch(apiUrl("/config/public"), { credentials: "include" })
      .then(async (r) => {
        if (!r.ok) {
          return { authMode: preferPassword ? "password" : "ponto" };
        }
        const text = await r.text();
        if (!text.trim()) {
          return { authMode: preferPassword ? "password" : "ponto" };
        }
        try {
          return JSON.parse(text) as { authMode?: string };
        } catch {
          return { authMode: preferPassword ? "password" : "ponto" };
        }
      })
      .then((data) => {
        const apiPassword = data?.authMode === "password";
        setMode(apiPassword || preferPassword ? "password" : "ponto");
      })
      .catch(() => setMode(preferPassword ? "password" : "ponto"));
  }, []);

  return mode;
}

function LoginPage() {
  const login = useAuthStore((s) => s.login);
  const loginPassword = useAuthStore((s) => s.loginPassword);
  const hydrate = useAuthStore((s) => s.hydrate);
  const isSubmitting = useAuthStore((s) => s.isSubmitting);
  const error = useAuthStore((s) => s.error);
  const clearError = useAuthStore((s) => s.clearError);
  const navigate = Route.useNavigate();
  const { redirect: redirectTo } = Route.useSearch();
  const authMode = useAuthMode();
  const painelPwaVariant = getPainelOsInstallVariant("/login", redirectTo);

  useEffect(() => {
    void hydrate().then(() => {
      const state = useAuthStore.getState();
      if (state.isAuthenticated) {
        void navigate({ to: resolveDefaultAppRoute(state.permissions, redirectTo) });
      }
    });
  }, [hydrate, navigate, redirectTo]);

  const pontoForm = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { ponto: "", nome: "", password: "" },
  });

  const passwordForm = useForm<PasswordLoginFormValues>({
    resolver: zodResolver(passwordLoginSchema),
    defaultValues: { login: "", password: "" },
  });

  const pontoValue = pontoForm.watch("ponto");
  const [requiresPassword, setRequiresPassword] = useState(false);

  useEffect(() => {
    const digits = pontoValue.replace(/\D/g, "");
    if (!digits) {
      pontoForm.setValue("nome", "");
      setRequiresPassword(false);
      return;
    }
    const pontoNum = Number.parseInt(digits, 10);
    if (!Number.isFinite(pontoNum) || pontoNum <= 0) {
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      void fetchUserNameByPonto(pontoNum).then(({ nome, requiresPassword: needsPwd }) => {
        if (cancelled || pontoForm.getValues("ponto") !== digits) {
          return;
        }
        pontoForm.setValue("nome", nome ?? "");
        setRequiresPassword(needsPwd);
        if (!needsPwd) {
          pontoForm.setValue("password", "");
        }
      });
    }, 300);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [pontoValue, pontoForm]);

  const onPontoSubmit = pontoForm.handleSubmit(async (values) => {
    clearError();
    const ponto = Number.parseInt(values.ponto, 10);
    if (requiresPassword && !values.password?.trim()) {
      pontoForm.setError("password", {
        type: "manual",
        message: "Informe sua senha para acessar deste IP.",
      });
      return;
    }
    await login(ponto, values.nome.trim(), values.password?.trim() || undefined);
    const state = useAuthStore.getState();
    if (state.isAuthenticated) {
      await navigate({ to: resolveDefaultAppRoute(state.permissions, redirectTo) });
    }
  });

  const onPasswordSubmit = passwordForm.handleSubmit(async (values) => {
    clearError();
    const raw = values.login.trim();
    const loginId = raw.includes("@") ? raw : sanitizePontoDigits(raw);
    await loginPassword(loginId, values.password);
    const state = useAuthStore.getState();
    if (state.isAuthenticated) {
      await navigate({ to: resolveDefaultAppRoute(state.permissions, redirectTo) });
    }
  });

  if (authMode === null) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-secondary-blue/95">
        <Loader2 className="size-8 animate-spin text-white" aria-hidden />
      </div>
    );
  }

  const isPasswordMode = authMode === "password";

  return (
    <div className="flex min-h-screen items-center justify-center bg-secondary-blue/95 p-4">
      {painelPwaVariant ? <PainelOsPwaHead variant={painelPwaVariant} /> : null}
      <div className="w-full max-w-sm rounded-lg border-t-4 border-secondary-blue bg-white p-8 shadow-xl">
        <div className="mb-6 text-center">
          <h1 className="text-xl font-semibold text-secondary-blue">SAGRA Web</h1>
          <p className="mt-1 text-sm text-neutral-600">
            {isPasswordMode ? "Acesso via internet" : "Identificação por ponto"}
          </p>
        </div>

        {isPasswordMode ? (
          <form onSubmit={(e) => void onPasswordSubmit(e)} className="space-y-4">
            <div>
              <label htmlFor="login" className="mb-1 block text-sm font-medium text-sagra-text">
                E-mail ou ponto
              </label>
              <input
                id="login"
                type="text"
                autoComplete="username"
                className="w-full rounded-md border border-sagra-border px-3 py-2 text-sm outline-none focus:border-primary-green focus:ring-1 focus:ring-primary-green"
                placeholder="E-mail ou ponto numérico (ex.: 918713)"
                {...passwordForm.register("login")}
              />
              <p className="mt-1 text-xs text-neutral-500">{LOGIN_HINT}</p>
              {passwordForm.formState.errors.login && (
                <p className="mt-1 text-xs text-sagra-danger">
                  {passwordForm.formState.errors.login.message}
                </p>
              )}
            </div>

            <div>
              <label htmlFor="password" className="mb-1 block text-sm font-medium text-sagra-text">
                Senha
              </label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                className="w-full rounded-md border border-sagra-border px-3 py-2 text-sm outline-none focus:border-primary-green focus:ring-1 focus:ring-primary-green"
                {...passwordForm.register("password")}
              />
              {passwordForm.formState.errors.password && (
                <p className="mt-1 text-xs text-sagra-danger">
                  {passwordForm.formState.errors.password.message}
                </p>
              )}
              <p className="mt-2 text-right">
                <Link
                  to="/login/forgot"
                  className="text-xs text-secondary-blue hover:underline"
                >
                  Esqueci minha senha
                </Link>
              </p>
            </div>

            {error && (
              <div
                role="alert"
                className="rounded-md border border-sagra-danger/30 bg-red-50 px-3 py-2 text-sm text-sagra-danger"
              >
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={isSubmitting}
              className="flex w-full items-center justify-center gap-2 rounded-md bg-primary-green py-2.5 text-sm font-semibold text-white hover:bg-primary-green/90 disabled:opacity-60"
            >
              {isSubmitting && <Loader2 className="size-4 animate-spin" />}
              Entrar
            </button>
          </form>
        ) : (
          <form onSubmit={(e) => void onPontoSubmit(e)} className="space-y-4">
            <div>
              <label htmlFor="ponto" className="mb-1 block text-sm font-medium text-sagra-text">
                Ponto (apenas números)
              </label>
              <div className="relative">
                <span
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-medium text-neutral-600"
                  aria-hidden
                >
                  P_
                </span>
                <input
                  id="ponto"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  autoComplete="username"
                  className="w-full rounded-md border border-sagra-border py-2 pl-9 pr-3 text-sm outline-none focus:border-primary-green focus:ring-1 focus:ring-primary-green"
                  placeholder="918713"
                  value={pontoValue}
                  onChange={(e) => {
                    pontoForm.setValue("ponto", sanitizePontoDigits(e.target.value), {
                      shouldValidate: true,
                    });
                  }}
                  onBlur={() => {
                    void pontoForm.trigger("ponto");
                  }}
                />
              </div>
              <p className="mt-1 text-xs text-neutral-500">{PONTO_HINT}</p>
              {pontoForm.formState.errors.ponto && (
                <p className="mt-1 text-xs text-sagra-danger">
                  {pontoForm.formState.errors.ponto.message}
                </p>
              )}
            </div>

            <div>
              <label htmlFor="nome" className="mb-1 block text-sm font-medium text-sagra-text">
                Nome completo
              </label>
              <input
                id="nome"
                type="text"
                autoComplete="name"
                className="w-full rounded-md border border-sagra-border px-3 py-2 text-sm outline-none focus:border-primary-green focus:ring-1 focus:ring-primary-green"
                placeholder="Seu nome"
                {...pontoForm.register("nome")}
              />
              {pontoForm.formState.errors.nome && (
                <p className="mt-1 text-xs text-sagra-danger">
                  {pontoForm.formState.errors.nome.message}
                </p>
              )}
            </div>

            {requiresPassword ? (
              <div>
                <label
                  htmlFor="local-password"
                  className="mb-1 block text-sm font-medium text-sagra-text"
                >
                  Senha
                </label>
                <input
                  id="local-password"
                  type="password"
                  autoComplete="current-password"
                  className="w-full rounded-md border border-sagra-border px-3 py-2 text-sm outline-none focus:border-primary-green focus:ring-1 focus:ring-primary-green"
                  {...pontoForm.register("password")}
                />
                <p className="mt-1 text-xs text-amber-700">
                  Este IP não está cadastrado para o seu usuário. Informe a senha da sua conta.
                </p>
                {pontoForm.formState.errors.password && (
                  <p className="mt-1 text-xs text-sagra-danger">
                    {pontoForm.formState.errors.password.message}
                  </p>
                )}
              </div>
            ) : null}

            {error && (
              <div
                role="alert"
                className="rounded-md border border-sagra-danger/30 bg-red-50 px-3 py-2 text-sm text-sagra-danger"
              >
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={isSubmitting}
              className="flex w-full items-center justify-center gap-2 rounded-md bg-primary-green py-2.5 text-sm font-semibold text-white hover:bg-primary-green/90 disabled:opacity-60"
            >
              {isSubmitting && <Loader2 className="size-4 animate-spin" />}
              Entrar
            </button>
          </form>
        )}

        <p className="mt-4 text-center text-xs text-neutral-500">
          {isPasswordMode
            ? "Use o e-mail cadastrado ou o ponto numérico (somente dígitos)."
            : requiresPassword
              ? "Senha exigida porque este IP não está cadastrado para o seu usuário."
              : "O IP desta estação deve estar cadastrado em Admin IPs."}
        </p>
      </div>
    </div>
  );
}
