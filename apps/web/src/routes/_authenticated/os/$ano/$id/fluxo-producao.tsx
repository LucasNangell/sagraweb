import { createFileRoute } from "@tanstack/react-router";

import { AuthGuard } from "@/components/auth/AuthGuard";
import { ProducaoGanttFullPage } from "@/features/os/components/ProducaoGanttFullPage";

export const Route = createFileRoute("/_authenticated/os/$ano/$id/fluxo-producao")({
  component: FluxoProducaoRoute,
});

function FluxoProducaoRoute() {
  const { ano, id } = Route.useParams();
  const anoNum = Number.parseInt(ano, 10);
  const idNum = Number.parseInt(id, 10);

  return (
    <AuthGuard requiredPermission="sb_gerencia">
      <ProducaoGanttFullPage ano={anoNum} osId={idNum} />
    </AuthGuard>
  );
}
