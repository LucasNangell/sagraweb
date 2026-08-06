import { zodResolver } from "@hookform/resolvers/zod";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { CheckCircle2, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";

import { activateAccount, checkActivationToken } from "@/features/auth/api";
import {
  activateSchema,
  type ActivateFormValues,
} from "@/features/auth/passwordLoginSchema";

export const Route = createFileRoute("/login/activate")({
  validateSearch: (search: Record<string, unknown>) => ({
    token: typeof search.token === "string" ? search.token : "",
  }),
  component: ActivatePage,
});

function ActivatePage() {
  const { token } = Route.useSearch();
  const navigate = useNavigate();
  const [checking, setChecking] = useState(true);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [userName, setUserName] = useState<string>("");
  const [done, setDone] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ActivateFormValues>({
    resolver: zodResolver(activateSchema),
    defaultValues: { password: "", confirmPassword: "" },
  });

  useEffect(() => {
    if (!token) {
      setCheckError("Link de ativação inválido.");
      setChecking(false);
      return;
    }
    void checkActivationToken(token)
      .then((data) => {
        if (data.account_type === "cliente") {
          const target = data.redirect || "/cliente/login/activate";
          void navigate({
            to: target,
            search: target.includes("activate") ? { token } : undefined,
            replace: true,
          });
          return;
        }
        if (data.already_active) {
          setDone(true);
        } else if (data.nome) {
          setUserName(data.nome);
        }
      })
      .catch((err: Error) => {
        setCheckError(err.message || "Token inválido ou expirado.");
      })
      .finally(() => setChecking(false));
  }, [token]);

  const onSubmit = handleSubmit(async (values) => {
    if (!token) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await activateAccount(token, values.password);
      setDone(true);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Falha ao ativar conta.");
    } finally {
      setSubmitting(false);
    }
  });

  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-secondary-blue/95">
        <Loader2 className="size-8 animate-spin text-white" aria-hidden />
      </div>
    );
  }

  if (checkError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-secondary-blue/95 p-4">
        <div className="w-full max-w-sm rounded-lg bg-white p-8 text-center shadow-xl">
          <p className="text-sm text-sagra-danger">{checkError}</p>
        </div>
      </div>
    );
  }

  if (done) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-secondary-blue/95 p-4">
        <div className="w-full max-w-sm rounded-lg bg-white p-8 text-center shadow-xl">
          <CheckCircle2 className="mx-auto mb-3 size-10 text-primary-green" aria-hidden />
          <h1 className="text-lg font-semibold text-secondary-blue">Conta ativada</h1>
          <p className="mt-2 text-sm text-neutral-600">
            Sua senha foi definida. Faça login para continuar.
          </p>
          <button
            type="button"
            onClick={() => void navigate({ to: "/login" })}
            className="mt-4 w-full rounded-md bg-primary-green py-2.5 text-sm font-semibold text-white hover:bg-primary-green/90"
          >
            Ir para login
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-secondary-blue/95 p-4">
      <div className="w-full max-w-sm rounded-lg border-t-4 border-secondary-blue bg-white p-8 shadow-xl">
        <div className="mb-6 text-center">
          <h1 className="text-xl font-semibold text-secondary-blue">Ativar cadastro</h1>
          {userName ? (
            <p className="mt-1 text-sm text-neutral-600">Olá, {userName}</p>
          ) : null}
          <p className="mt-1 text-sm text-neutral-600">Defina sua senha de acesso</p>
        </div>

        <form onSubmit={(e) => void onSubmit(e)} className="space-y-4">
          <div>
            <label htmlFor="password" className="mb-1 block text-sm font-medium text-sagra-text">
              Nova senha
            </label>
            <input
              id="password"
              type="password"
              autoComplete="new-password"
              className="w-full rounded-md border border-sagra-border px-3 py-2 text-sm outline-none focus:border-primary-green focus:ring-1 focus:ring-primary-green"
              {...register("password")}
            />
            {errors.password && (
              <p className="mt-1 text-xs text-sagra-danger">{errors.password.message}</p>
            )}
          </div>

          <div>
            <label
              htmlFor="confirmPassword"
              className="mb-1 block text-sm font-medium text-sagra-text"
            >
              Confirmar senha
            </label>
            <input
              id="confirmPassword"
              type="password"
              autoComplete="new-password"
              className="w-full rounded-md border border-sagra-border px-3 py-2 text-sm outline-none focus:border-primary-green focus:ring-1 focus:ring-primary-green"
              {...register("confirmPassword")}
            />
            {errors.confirmPassword && (
              <p className="mt-1 text-xs text-sagra-danger">
                {errors.confirmPassword.message}
              </p>
            )}
          </div>

          {submitError && (
            <div
              role="alert"
              className="rounded-md border border-sagra-danger/30 bg-red-50 px-3 py-2 text-sm text-sagra-danger"
            >
              {submitError}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="flex w-full items-center justify-center gap-2 rounded-md bg-primary-green py-2.5 text-sm font-semibold text-white hover:bg-primary-green/90 disabled:opacity-60"
          >
            {submitting && <Loader2 className="size-4 animate-spin" />}
            Ativar conta
          </button>
        </form>
      </div>
    </div>
  );
}
