import { createFileRoute } from "@tanstack/react-router";

import { TabletAccessGuard } from "@/components/auth/TabletAccessGuard";
import { PainelOsPwaHead } from "@/components/pwa/PainelOsPwaHead";
import { DashboardTabletPage } from "@/features/dashboard-tablet/components/DashboardTabletPage";

export const Route = createFileRoute("/painel/celular")({
  component: PainelCelularRoute,
});

function PainelCelularRoute() {
  return (
    <>
      <PainelOsPwaHead />
      <TabletAccessGuard loginRedirect="/painel/celular">
        <DashboardTabletPage identityMode="session" />
      </TabletAccessGuard>
    </>
  );
}
