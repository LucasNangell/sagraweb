import { createFileRoute } from "@tanstack/react-router";

import { AuthGuard } from "@/components/auth/AuthGuard";
import { RequisicaoPrintPage } from "@/features/os/components/RequisicaoPrintPage";
import type { RequisicaoPrintMode } from "@/features/os/utils/requisicaoReportUrl";

function parseMode(value: unknown): RequisicaoPrintMode {
  if (value === "prova_ficha") return "prova_ficha";
  if (value === "prova") return "prova";
  return "normal";
}

export const Route = createFileRoute(
  "/_authenticated/impressao/requisicao/$ano/$id",
)({
  validateSearch: (search: Record<string, unknown>) => ({
    mode: parseMode(search.mode),
    print: search.print === "1" || search.print === 1 || search.print === true,
  }),
  component: RequisicaoPrintRoute,
});

function RequisicaoPrintRoute() {
  const { ano, id } = Route.useParams();
  const { mode, print } = Route.useSearch();

  const anoNum = Number.parseInt(ano, 10);
  const idNum = Number.parseInt(id, 10);

  return (
    <AuthGuard requiredPermission="ctx_imprimir_ficha">
      <RequisicaoPrintPage
        ano={anoNum}
        id={idNum}
        mode={mode}
        autoPrint={print}
      />
    </AuthGuard>
  );
}
