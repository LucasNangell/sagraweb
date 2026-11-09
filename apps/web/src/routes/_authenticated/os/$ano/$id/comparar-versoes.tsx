import { createFileRoute } from "@tanstack/react-router";

import { AuthGuard } from "@/components/auth/AuthGuard";
import { OsPdfComparePage } from "@/features/os-pdf-compare/OsPdfComparePage";

export const Route = createFileRoute(
  "/_authenticated/os/$ano/$id/comparar-versoes",
)({
  component: CompararVersoesRoute,
});

function CompararVersoesRoute() {
  const { ano, id } = Route.useParams();
  const anoNum = Number.parseInt(ano, 10);
  const idNum = Number.parseInt(id, 10);

  return (
    <AuthGuard requiredPermission="ctx_comparar_versoes">
      <OsPdfComparePage ano={anoNum} osId={idNum} />
    </AuthGuard>
  );
}
