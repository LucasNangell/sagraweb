import { createFileRoute } from "@tanstack/react-router";

import { AuthGuard } from "@/components/auth/AuthGuard";
import { PAINEL_CONFIG_ADMIN_PONTO } from "@/features/auth/painelConfigAdmin";
import { PainelAdminPreviewPage } from "@/features/painel-admin/components/PainelAdminPreviewPage";

export const Route = createFileRoute("/painel/preview-admin")({
  component: PainelPreviewAdminRoute,
});

function PainelPreviewAdminRoute() {
  return (
    <AuthGuard requiredPonto={PAINEL_CONFIG_ADMIN_PONTO}>
      <PainelAdminPreviewPage />
    </AuthGuard>
  );
}
