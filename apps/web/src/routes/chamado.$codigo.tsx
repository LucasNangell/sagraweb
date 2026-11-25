import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";

import { RoutePageFallback } from "@/components/RoutePageFallback";

const ChamadoPublicoPage = lazy(() =>
  import("@/features/manutencao/components/ChamadoPublicoPage").then((m) => ({
    default: m.ChamadoPublicoPage,
  })),
);

/** Página pública (sem login/IP) aberta pelo QR Code colado na máquina. */
export const Route = createFileRoute("/chamado/$codigo")({
  component: ChamadoRoute,
});

function ChamadoRoute() {
  const { codigo } = Route.useParams();
  return (
    <Suspense fallback={<RoutePageFallback />}>
      <ChamadoPublicoPage codigo={codigo.trim().toUpperCase()} />
    </Suspense>
  );
}
