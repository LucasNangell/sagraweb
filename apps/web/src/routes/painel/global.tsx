import { createFileRoute } from "@tanstack/react-router";

import { PainelAccessGuard } from "@/components/auth/PainelAccessGuard";
import { PainelGlobalPage } from "@/features/painel-global/components/PainelGlobalPage";

export const Route = createFileRoute("/painel/global")({
  component: PainelGlobalRoute,
});

function PainelGlobalRoute() {
  return (
    <PainelAccessGuard route="/painel/global">
      <PainelGlobalPage />
    </PainelAccessGuard>
  );
}
