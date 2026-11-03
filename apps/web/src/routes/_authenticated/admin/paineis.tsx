import { createFileRoute } from "@tanstack/react-router";

import { AuthGuard } from "@/components/auth/AuthGuard";
import { PAINEL_CONFIG_ADMIN_PONTO } from "@/features/auth/painelConfigAdmin";
import { PainelAdminPage } from "@/features/painel-admin/components/PainelAdminPage";

export const Route = createFileRoute("/_authenticated/admin/paineis")({
  component: PainelAdminRoute,
});

function PainelAdminRoute() {
  return (
    <AuthGuard requiredPonto={PAINEL_CONFIG_ADMIN_PONTO}>
      <PainelAdminPage />
    </AuthGuard>
  );
}
