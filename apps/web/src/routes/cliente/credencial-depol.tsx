import { Navigate, createFileRoute } from "@tanstack/react-router";

import {
  clienteDepolModeloThumbUrl,
  createClienteCredenciaisDepolPedido,
  fetchClienteCredenciaisDepolModelos,
} from "@/api/cliente-portal";
import type { CredenciaisDepolModelo } from "@/api/credenciais-depol";
import { useClienteStore } from "@/features/cliente/clienteStore";
import { ClienteAuthenticatedLayout } from "@/features/cliente/layout/ClienteAuthenticatedLayout";
import { CredenciaisDepolPedidoPanel } from "@/features/credenciais-depol/components/CredenciaisDepolPedidoPanel";
import { DEPOL_DRAFT_STORAGE_CLIENTE } from "@/features/credenciais-depol/depolPedidoDraftStorage";

export const Route = createFileRoute("/cliente/credencial-depol")({
  component: ClienteCredencialDepolRoute,
});

const CLIENTE_PEDIDO_ADAPTERS = {
  queryKey: ["cliente", "credenciais-depol", "modelos"] as const,
  fetchModelos: async () => {
    const res = await fetchClienteCredenciaisDepolModelos();
    return { modelos: res.modelos as CredenciaisDepolModelo[] };
  },
  createPedido: createClienteCredenciaisDepolPedido,
  thumbUrl: clienteDepolModeloThumbUrl,
  draftStorageKey: DEPOL_DRAFT_STORAGE_CLIENTE,
  emptyModelosHint:
    "Nenhum modelo disponível no momento. Entre em contato com a gráfica.",
};

function ClienteCredencialDepolContent() {
  const navDepol = useClienteStore((s) => s.user?.nav_credencial_depol === true);

  if (!navDepol) {
    return <Navigate to="/cliente" replace />;
  }

  return (
    <div className="flex min-h-min flex-1 flex-col gap-3">
      <header className="px-1">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          Credencial DEPOL
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Monte o pedido de credenciais escolhendo o modelo e o texto.
        </p>
      </header>
      <CredenciaisDepolPedidoPanel adapters={CLIENTE_PEDIDO_ADAPTERS} />
    </div>
  );
}

function ClienteCredencialDepolRoute() {
  return (
    <ClienteAuthenticatedLayout>
      <ClienteCredencialDepolContent />
    </ClienteAuthenticatedLayout>
  );
}
