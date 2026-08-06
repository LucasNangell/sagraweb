import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouterState } from "@tanstack/react-router";

import { fetchClienteSupportSettings } from "@/api/cliente-support";
import { queryKeys } from "@/api/query-keys";
import { ClienteAuthGuard } from "@/components/auth/ClienteAuthGuard";
import { ClientePtSupportFab } from "@/features/cliente/components/ClientePtSupportFab";
import { ClienteSupportModal } from "@/features/cliente/components/ClienteSupportModal";
import { useClienteSupportUiStore } from "@/features/cliente/clienteSupportUiStore";

import { ClientePortalShell } from "./ClientePortalShell";

interface ClienteAuthenticatedLayoutProps {
  children: ReactNode;
}

const PT_OS_ROUTE_RE = /\/cliente\/os\/(\d+)\/(\d+)\/problemas-tecnicos\/?$/;

export function ClienteAuthenticatedLayout({ children }: ClienteAuthenticatedLayoutProps) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const fullWidth = pathname.includes("/prova");
  const isPtSection = pathname.includes("/problemas-tecnicos");
  const osMatch = pathname.match(PT_OS_ROUTE_RE);
  const fabContext = useClienteSupportUiStore((s) => s.fabContext);
  const ptAno = osMatch
    ? Number.parseInt(osMatch[1]!, 10)
    : (fabContext?.ano ?? null);
  const ptNrOs = osMatch
    ? Number.parseInt(osMatch[2]!, 10)
    : (fabContext?.nrOs ?? null);
  const ptVersao = osMatch ? (fabContext?.versao ?? null) : (fabContext?.versao ?? null);
  const settingsQuery = useQuery({
    queryKey: queryKeys.support.clienteSettings,
    queryFn: fetchClienteSupportSettings,
    staleTime: 60_000,
  });
  const clienteChatEnabled = settingsQuery.data?.cliente_chat_enabled ?? true;
  const showClienteChat = isPtSection && clienteChatEnabled;

  return (
    <ClienteAuthGuard>
      <ClientePortalShell fullWidth={fullWidth}>{children}</ClientePortalShell>
      {showClienteChat ? <ClienteSupportModal /> : null}
      {showClienteChat && ptAno != null && ptNrOs != null ? (
        <ClientePtSupportFab ano={ptAno} nrOs={ptNrOs} versao={ptVersao} />
      ) : null}
    </ClienteAuthGuard>
  );
}
