import { createFileRoute } from "@tanstack/react-router";

import { AuthGuard } from "@/components/auth/AuthGuard";
import { AdminSupportMessagesPage } from "@/features/support/components/AdminSupportMessagesPage";

export const Route = createFileRoute("/_authenticated/admin/mensagens")({
  validateSearch: (search: Record<string, unknown>) => {
    const raw = search.ticket;
    const ticket =
      typeof raw === "number"
        ? raw
        : typeof raw === "string"
          ? Number.parseInt(raw, 10)
          : undefined;
    return {
      ticket: ticket != null && !Number.isNaN(ticket) && ticket > 0 ? ticket : undefined,
    };
  },
  component: AdminMensagensRoute,
});

function AdminMensagensRoute() {
  const { ticket } = Route.useSearch();
  return (
    <AuthGuard requiredPermission="sb_admin_ips">
      <AdminSupportMessagesPage initialTicketId={ticket} />
    </AuthGuard>
  );
}
