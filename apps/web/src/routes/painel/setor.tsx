import { createFileRoute } from "@tanstack/react-router";

import { PainelAccessGuard } from "@/components/auth/PainelAccessGuard";
import { DashboardSetorPage } from "@/features/dashboard-setor/components/DashboardSetorPage";

export const Route = createFileRoute("/painel/setor")({
  component: PainelSetorRoute,
});

function PainelSetorRoute() {
  return (
    <PainelAccessGuard route="/painel/setor">
      <DashboardSetorPage />
    </PainelAccessGuard>
  );
}
