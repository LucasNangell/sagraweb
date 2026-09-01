import { Navigate, createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";

import {
  clienteDepolModeloThumbUrl,
  createClienteCredenciaisDepolPedido,
  fetchClienteCredenciaisDepolModelos,
  fetchClienteDepolPedidoDraft,
  saveClienteDepolPedidoDraft,
} from "@/api/cliente-portal";
import type { CredenciaisDepolModelo } from "@/api/credenciais-depol";
import { useClienteStore } from "@/features/cliente/clienteStore";
import { ClienteAuthenticatedLayout } from "@/features/cliente/layout/ClienteAuthenticatedLayout";
import { CredenciaisDepolPedidoPanel } from "@/features/credenciais-depol/components/CredenciaisDepolPedidoPanel";
import {
  clienteDepolDraftStorageKey,
  loadClienteDepolPedidoDraft,
} from "@/features/credenciais-depol/depolPedidoDraftStorage";

export const Route = createFileRoute("/cliente/credencial-depol")({
  component: ClienteCredencialDepolRoute,
});

function ClienteCredencialDepolContent() {
  const user = useClienteStore((s) => s.user);
  const navDepol = user?.nav_credencial_depol === true;
  const clienteId = user?.id ?? 0;

  const adapters = useMemo(
    () => ({
      queryKey: ["cliente", "credenciais-depol", "modelos"] as const,
      fetchModelos: async () => {
        const res = await fetchClienteCredenciaisDepolModelos();
        return { modelos: res.modelos as CredenciaisDepolModelo[] };
      },
      createPedido: createClienteCredenciaisDepolPedido,
      thumbUrl: clienteDepolModeloThumbUrl,
      draftStorageKey: clienteDepolDraftStorageKey(clienteId),
      loadDraft: () => loadClienteDepolPedidoDraft(clienteId),
      fetchRemoteDraft: fetchClienteDepolPedidoDraft,
      saveRemoteDraft: saveClienteDepolPedidoDraft,
      persistHint:
        "A lista fica salva na sua conta até você enviar o pedido. Pode sair e voltar depois.",
      emptyModelosHint:
        "Nenhum modelo disponível no momento. Entre em contato com a gráfica.",
    }),
    [clienteId],
  );

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
      <CredenciaisDepolPedidoPanel adapters={adapters} />
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
