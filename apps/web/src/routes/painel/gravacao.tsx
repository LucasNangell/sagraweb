import { createFileRoute } from "@tanstack/react-router";

import { TabletAccessGuard } from "@/components/auth/TabletAccessGuard";
import { PainelOsPwaHead } from "@/components/pwa/PainelOsPwaHead";
import { DashboardGravacaoPage } from "@/features/dashboard-gravacao/components/DashboardGravacaoPage";

export const Route = createFileRoute("/painel/gravacao")({
  component: PainelGravacaoRoute,
});

function PainelGravacaoRoute() {
  return (
    <>
      <PainelOsPwaHead />
      <TabletAccessGuard loginRedirect="/painel/gravacao">
        <DashboardGravacaoPage />
      </TabletAccessGuard>
    </>
  );
}
