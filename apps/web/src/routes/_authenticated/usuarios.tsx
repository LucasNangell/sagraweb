import { createFileRoute, redirect } from "@tanstack/react-router";

/** Rota legada: Usuários virou a aba Usuários do Controle de Acesso. */
export const Route = createFileRoute("/_authenticated/usuarios")({
  beforeLoad: () => {
    throw redirect({ to: "/admin/acesso", search: { aba: "usuarios" }, replace: true });
  },
});
