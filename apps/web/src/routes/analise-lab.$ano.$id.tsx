import { createFileRoute } from "@tanstack/react-router";

import { AuthGuard } from "@/components/auth/AuthGuard";
import { AnaliseLabPage } from "@/features/analise-lab/AnaliseLabPage";

export const Route = createFileRoute("/analise-lab/$ano/$id")({
  component: AnaliseLabRoute,
});

function AnaliseLabRoute() {
  const { ano, id } = Route.useParams();
  return (
    <AuthGuard requiredPermission="sb_analise">
      <AnaliseLabPage ano={Number(ano)} osId={Number(id)} />
    </AuthGuard>
  );
}
