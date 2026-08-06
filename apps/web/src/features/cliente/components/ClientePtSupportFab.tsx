import { MessageCircle } from "lucide-react";
import { useQuery } from "@tanstack/react-query";

import { fetchClienteOpenSupportTicket } from "@/api/cliente-support";
import { queryKeys } from "@/api/query-keys";
import { useClienteSupportUiStore } from "@/features/cliente/clienteSupportUiStore";
import { cn } from "@sagra/ui";

interface ClientePtSupportFabProps {
  ano?: number | null;
  nrOs?: number | null;
  versao?: string | null;
  className?: string;
}

export function ClientePtSupportFab({
  ano,
  nrOs,
  versao = null,
  className,
}: ClientePtSupportFabProps) {
  const openChat = useClienteSupportUiStore((s) => s.openChat);

  const hasOs = ano != null && nrOs != null;
  const openTicketQuery = useQuery({
    queryKey:
      hasOs ? queryKeys.support.clienteOpenTicket(ano, nrOs) : ["support", "clienteOpenTicket", "idle"],
    queryFn: () => fetchClienteOpenSupportTicket(ano!, nrOs!),
    enabled: hasOs,
    staleTime: 30_000,
  });

  const hasOpenChat = Boolean(openTicketQuery.data?.Id);

  const handleClick = () => {
    if (!hasOs) {
      return;
    }
    openChat({
      ano,
      nrOs,
      versao,
      ticketId: openTicketQuery.data?.Id ?? null,
    });
  };

  if (!hasOs) {
    return null;
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className={cn(
        "fixed bottom-[calc(5.5rem+env(safe-area-inset-bottom,0px))] right-4 z-50",
        "flex size-14 items-center justify-center rounded-full bg-secondary-blue text-white shadow-lg",
        "hover:bg-secondary-blue/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-secondary-blue",
        "md:bottom-6",
        className,
      )}
      aria-label="Chat de dúvidas sobre problemas técnicos"
      title="Tirar dúvidas"
    >
      <MessageCircle className="size-7" aria-hidden />
      {hasOpenChat ? (
        <span className="absolute -right-0.5 -top-0.5 size-3.5 rounded-full bg-primary-green ring-2 ring-white" />
      ) : null}
    </button>
  );
}
