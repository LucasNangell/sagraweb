import { createFileRoute } from "@tanstack/react-router";

import { AuthGuard } from "@/components/auth/AuthGuard";
import { ConfiguracoesPage } from "@/features/configuracoes/components/ConfiguracoesPage";

export const Route = createFileRoute("/_authenticated/admin/configuracoes")({
  component: ConfiguracoesRoute,
});

function ConfiguracoesRoute() {
  return (
    <AuthGuard requiredPermission="sb_admin_ips">
      <ConfiguracoesPage />
    </AuthGuard>
  );
}
