import { createFileRoute } from "@tanstack/react-router";

import { AuthGuard } from "@/components/auth/AuthGuard";
import { UserSupportMessagesPage } from "@/features/support/components/UserSupportMessagesPage";

export const Route = createFileRoute("/_authenticated/mensagens")({
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
  component: UserMensagensRoute,
});

function UserMensagensRoute() {
  const { ticket } = Route.useSearch();
  return (
    <AuthGuard>
      <UserSupportMessagesPage initialTicketId={ticket} />
    </AuthGuard>
  );
}
