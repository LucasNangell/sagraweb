import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";

import { AuthGuard } from "@/components/auth/AuthGuard";
import { RoutePageFallback } from "@/components/RoutePageFallback";

const ManutencaoPage = lazy(() =>
  import("@/features/manutencao/components/ManutencaoPage").then((m) => ({
    default: m.ManutencaoPage,
  })),
);

export type ManutencaoSearch = {
  aba?: "gerencia" | "operador";
  /** Código da máquina (ex.: MAQ-0004) — base para QR Code colado na máquina. */
  maquina?: string;
  /** Pedido a abrir (link das notificações push). */
  pedido?: number;
};

export const Route = createFileRoute("/_authenticated/manutencao")({
  validateSearch: (search: Record<string, unknown>): ManutencaoSearch => {
    const aba = search["aba"];
    const maquina = search["maquina"];
    const pedidoNum = Number(search["pedido"]);
    return {
      aba: aba === "gerencia" || aba === "operador" ? aba : undefined,
      maquina:
        typeof maquina === "string" && maquina.trim() ? maquina.trim().toUpperCase() : undefined,
      pedido: Number.isInteger(pedidoNum) && pedidoNum > 0 ? pedidoNum : undefined,
    };
  },
  component: ManutencaoRoute,
});

function ManutencaoRoute() {
  const search = Route.useSearch();
  return (
    <AuthGuard
      requiredAnyPermission={["sb_manutencao_gerencia", "sb_manutencao_operador"]}
    >
      <Suspense fallback={<RoutePageFallback />}>
        <ManutencaoPage
          initialTab={search.aba}
          maquinaCodigo={search.maquina}
          pedidoId={search.pedido}
        />
      </Suspense>
    </AuthGuard>
  );
}
