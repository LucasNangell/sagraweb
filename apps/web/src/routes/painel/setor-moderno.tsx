import { createFileRoute } from "@tanstack/react-router";

import { PainelAccessGuard } from "@/components/auth/PainelAccessGuard";
import { PainelOsPwaHead } from "@/components/pwa/PainelOsPwaHead";
import { DashboardSetorModernPage } from "@/features/dashboard-setor-modern/components/DashboardSetorModernPage";

export const Route = createFileRoute("/painel/setor-moderno")({
  component: PainelSetorModernRoute,
});

function PainelSetorModernRoute() {
  return (
    <>
      <PainelOsPwaHead variant="setor-moderno" />
      <PainelAccessGuard route="/painel/setor">
        <DashboardSetorModernPage />
      </PainelAccessGuard>
    </>
  );
}
