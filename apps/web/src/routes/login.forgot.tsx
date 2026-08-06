import { zodResolver } from "@hookform/resolvers/zod";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { CheckCircle2, Loader2 } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { requestPasswordReset } from "@/features/auth/api";
import {
  forgotPasswordSchema,
  type ForgotPasswordFormValues,
} from "@/features/auth/passwordLoginSchema";

export const Route = createFileRoute("/login/forgot")({
  component: ForgotPasswordPage,
});

function ForgotPasswordPage() {
  const navigate = useNavigate();
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [successMessage, setSuccessMessage] = useState("");

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ForgotPasswordFormValues>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: "" },
  });

  const onSubmit = handleSubmit(async (values) => {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await requestPasswordReset(values.email);
      setSuccessMessage(
        res.message ||
          "Se o e-mail estiver cadastrado, você receberá um link para redefinir sua senha.",
      );
      setDone(true);
    } catch (err) {
      setSubmitError(
        err instanceof Error ? err.message : "Falha ao solicitar recuperação de senha.",
      );
    } finally {
      setSubmitting(false);
    }
  });

  if (done) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-secondary-blue/95 p-4">
        <div className="w-full max-w-sm rounded-lg bg-white p-8 text-center shadow-xl">
          <CheckCircle2 className="mx-auto mb-3 size-10 text-primary-green" aria-hidden />
          <h1 className="text-lg font-semibold text-secondary-blue">Verifique seu e-mail</h1>
          <p className="mt-2 text-sm text-neutral-600">{successMessage}</p>
          <button
            type="button"
            onClick={() => void navigate({ to: "/login" })}
            className="mt-4 w-full rounded-md bg-primary-green py-2.5 text-sm font-semibold text-white hover:bg-primary-green/90"
          >
            Voltar ao login
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-secondary-blue/95 p-4">
      <div className="w-full max-w-sm rounded-lg border-t-4 border-secondary-blue bg-white p-8 shadow-xl">
        <div className="mb-6 text-center">
          <h1 className="text-xl font-semibold text-secondary-blue">Esqueci minha senha</h1>
          <p className="mt-1 text-sm text-neutral-600">
            Informe o e-mail cadastrado para receber o link de recuperação
          </p>
        </div>

        <form onSubmit={(e) => void onSubmit(e)} className="space-y-4">
          <div>
            <label htmlFor="email" className="mb-1 block text-sm font-medium text-sagra-text">
              E-mail
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              className="w-full rounded-md border border-sagra-border px-3 py-2 text-sm outline-none focus:border-primary-green focus:ring-1 focus:ring-primary-green"
              placeholder="seu.email@exemplo.com"
              {...register("email")}
            />
            {errors.email && (
              <p className="mt-1 text-xs text-sagra-danger">{errors.email.message}</p>
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
            Enviar link de recuperação
          </button>
        </form>

        <p className="mt-4 text-center text-sm">
          <Link to="/login" className="text-secondary-blue hover:underline">
            Voltar ao login
          </Link>
        </p>
      </div>
    </div>
  );
}
