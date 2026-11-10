import { createFileRoute, redirect } from "@tanstack/react-router";

/** Rota legada: Admin IPs virou a aba Terminais do Controle de Acesso. */
export const Route = createFileRoute("/_authenticated/admin/ips")({
  beforeLoad: () => {
    throw redirect({ to: "/admin/acesso", search: { aba: "terminais" }, replace: true });
  },
});
