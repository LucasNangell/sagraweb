import { zodResolver } from "@hookform/resolvers/zod";
import { Link, useNavigate } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { PortalSystemHeader } from "@/components/portal/PortalSystemHeader";
import { useClienteStore } from "@/features/cliente/clienteStore";

const loginSchema = z.object({
  email: z.string().email("Informe um e-mail válido."),
  password: z.string().min(1, "Informe a senha."),
});

type LoginForm = z.infer<typeof loginSchema>;

export function ClienteLoginPage() {
  const navigate = useNavigate();
  const login = useClienteStore((s) => s.login);
  const isSubmitting = useClienteStore((s) => s.isSubmitting);
  const error = useClienteStore((s) => s.error);
  const clearError = useClienteStore((s) => s.clearError);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
  });

  const onSubmit = handleSubmit(async (values) => {
    clearError();
    try {
      await login(values.email, values.password);
      await navigate({ to: "/cliente" });
    } catch {
      /* erro no store */
    }
  });

  return (
    <div className="min-h-screen bg-sagra-bg">
      <PortalSystemHeader subtitle="Portal do Cliente — Login" />
      <div className="mx-auto flex max-w-md flex-col px-4 py-10">
        <div className="rounded-xl border border-sagra-border bg-white p-6 shadow-sm">
          <h1 className="text-lg font-bold text-secondary-blue">Acesso do gabinete</h1>
          <p className="mt-1 text-sm text-neutral-600">
            <strong>Primeiro acesso?</strong> Abra o link do e-mail de ativação para{" "}
            <strong>criar sua senha</strong> — só depois use este login.
          </p>
          <p className="mt-2 text-sm text-neutral-600">
            Já ativou a conta? Informe o e-mail e a senha que você definiu.
          </p>

          <form className="mt-6 space-y-4" onSubmit={onSubmit}>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">E-mail</span>
              <input
                type="email"
                autoComplete="username"
                className="rounded-md border border-sagra-border px-3 py-2"
                {...register("email")}
              />
              {errors.email ? (
                <span className="text-xs text-red-600">{errors.email.message}</span>
              ) : null}
            </label>

            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">Senha</span>
              <input
                type="password"
                autoComplete="current-password"
                className="rounded-md border border-sagra-border px-3 py-2"
                {...register("password")}
              />
              {errors.password ? (
                <span className="text-xs text-red-600">{errors.password.message}</span>
              ) : null}
            </label>

            {error ? <p className="text-sm text-red-700">{error}</p> : null}

            <button
              type="submit"
              disabled={isSubmitting}
              className="flex w-full items-center justify-center gap-2 rounded-md bg-primary-green py-2.5 text-sm font-semibold text-white hover:bg-primary-green/90 disabled:opacity-60"
            >
              {isSubmitting ? <Loader2 className="size-4 animate-spin" /> : null}
              Entrar
            </button>
          </form>

          <p className="mt-2 text-center text-xs text-neutral-500">
            Equipe interna:{" "}
            <Link to="/login" className="text-secondary-blue underline">
              login SAGRA
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
