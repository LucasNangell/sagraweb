import { createFileRoute } from "@tanstack/react-router";

import { PainelAccessGuard } from "@/components/auth/PainelAccessGuard";
import { DashboardSetorModernPage } from "@/features/dashboard-setor-modern/components/DashboardSetorModernPage";

export const Route = createFileRoute("/painel/setor-moderno")({
  component: PainelSetorModernRoute,
});

function PainelSetorModernRoute() {
  return (
    <PainelAccessGuard route="/painel/setor">
      <DashboardSetorModernPage />
    </PainelAccessGuard>
  );
}
