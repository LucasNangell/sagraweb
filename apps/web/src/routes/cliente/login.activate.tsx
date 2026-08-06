import { zodResolver } from "@hookform/resolvers/zod";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { CheckCircle2, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";

import {
  activateClienteAccount,
  checkClienteActivationToken,
} from "@/api/cliente-portal";
import { PortalSystemHeader } from "@/components/portal/PortalSystemHeader";
import {
  activateSchema,
  type ActivateFormValues,
} from "@/features/auth/passwordLoginSchema";

export const Route = createFileRoute("/cliente/login/activate")({
  validateSearch: (search: Record<string, unknown>) => ({
    token: typeof search.token === "string" ? search.token : "",
  }),
  component: ClienteActivatePage,
});

function ClienteActivatePage() {
  const { token } = Route.useSearch();
  const navigate = useNavigate();
  const [checking, setChecking] = useState(true);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [userName, setUserName] = useState("");
  const [gabinete, setGabinete] = useState("");
  const [vinculoLabel, setVinculoLabel] = useState("gabinete");
  const [done, setDone] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, dirtyFields },
  } = useForm<ActivateFormValues>({
    resolver: zodResolver(activateSchema),
    mode: "onChange",
    defaultValues: { password: "", confirmPassword: "" },
  });

  const passwordInvalid = Boolean(dirtyFields.password && errors.password);
  const confirmInvalid = Boolean(dirtyFields.confirmPassword && errors.confirmPassword);

  useEffect(() => {
    if (!token) {
      setCheckError("Link de ativação inválido.");
      setChecking(false);
      return;
    }
    void checkClienteActivationToken(token)
      .then((data) => {
        if (data.nome) setUserName(data.nome);
        if (data.gabinete) setGabinete(data.gabinete);
        if (data.vinculo_label) setVinculoLabel(data.vinculo_label);
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
      await activateClienteAccount(token, values.password);
      setDone(true);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Falha ao ativar conta.");
    } finally {
      setSubmitting(false);
    }
  });

  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-sagra-bg">
        <Loader2 className="size-8 animate-spin text-secondary-blue" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-sagra-bg">
      <PortalSystemHeader subtitle="Portal do Cliente — Ativação" />
      <div className="mx-auto max-w-md px-4 py-10">
        <div className="rounded-xl border border-sagra-border bg-white p-6 shadow-sm">
          {checkError ? (
            <p className="text-sm text-red-700">{checkError}</p>
          ) : done ? (
            <div className="text-center">
              <CheckCircle2 className="mx-auto size-12 text-primary-green" />
              <h1 className="mt-3 text-lg font-bold">Conta ativada</h1>
              <p className="mt-2 text-sm text-neutral-600">
                Sua senha foi definida. Faça login no portal do cliente.
              </p>
              <Link
                to="/cliente/login"
                className="mt-4 inline-block rounded-md bg-primary-green px-4 py-2 text-sm font-semibold text-white"
              >
                Ir para login
              </Link>
            </div>
          ) : (
            <>
              <h1 className="text-lg font-bold text-secondary-blue">Criar senha</h1>
              <p className="mt-1 text-sm text-neutral-600">
                {userName ? (
                  <>
                    Olá, <strong>{userName}</strong>
                    {gabinete ? (
                      <>
                        {" "}
                        — {vinculoLabel} <strong>{gabinete}</strong>
                      </>
                    ) : null}
                  </>
                ) : (
                  "Defina sua senha de acesso ao portal."
                )}
              </p>
              <form className="mt-6 space-y-4" onSubmit={onSubmit}>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="font-medium">Nova senha (mínimo 8 caracteres)</span>
                  <input
                    type="password"
                    autoComplete="new-password"
                    className={`rounded-md border px-3 py-2 outline-none ${
                      passwordInvalid
                        ? "border-red-500 focus:border-red-500 focus:ring-1 focus:ring-red-500"
                        : "border-sagra-border focus:border-primary-green focus:ring-1 focus:ring-primary-green"
                    }`}
                    {...register("password")}
                  />
                  {passwordInvalid ? (
                    <span className="text-xs text-red-600">{errors.password?.message}</span>
                  ) : null}
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="font-medium">Confirmar senha</span>
                  <input
                    type="password"
                    autoComplete="new-password"
                    className={`rounded-md border px-3 py-2 outline-none ${
                      confirmInvalid
                        ? "border-red-500 focus:border-red-500 focus:ring-1 focus:ring-red-500"
                        : "border-sagra-border focus:border-primary-green focus:ring-1 focus:ring-primary-green"
                    }`}
                    {...register("confirmPassword")}
                  />
                  {confirmInvalid ? (
                    <span className="text-xs text-red-600">
                      {errors.confirmPassword?.message}
                    </span>
                  ) : null}
                </label>
                {submitError ? <p className="text-sm text-red-700">{submitError}</p> : null}
                <button
                  type="submit"
                  disabled={submitting}
                  className="flex w-full items-center justify-center gap-2 rounded-md bg-primary-green py-2.5 text-sm font-semibold text-white disabled:opacity-60"
                >
                  {submitting ? <Loader2 className="size-4 animate-spin" /> : null}
                  Ativar conta
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
