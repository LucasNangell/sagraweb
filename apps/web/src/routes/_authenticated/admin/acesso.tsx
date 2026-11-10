import { createFileRoute } from "@tanstack/react-router";

import { AuthGuard } from "@/components/auth/AuthGuard";
import { parseAcessoSearch } from "@/features/acesso/acessoTabs";
import { AcessoPage } from "@/features/acesso/components/AcessoPage";

export const Route = createFileRoute("/_authenticated/admin/acesso")({
  validateSearch: parseAcessoSearch,
  component: AcessoRoute,
});

function AcessoRoute() {
  const search = Route.useSearch();
  return (
    // Cada aba valida a própria chave (sb_usuarios → Usuários; sb_admin_ips → Terminais).
    <AuthGuard requiredAnyPermission={["sb_usuarios", "sb_admin_ips"]}>
      <AcessoPage search={search} />
    </AuthGuard>
  );
}
