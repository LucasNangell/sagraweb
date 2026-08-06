import { describe, expect, it } from "vitest";

import { extractSupportTicketId } from "@/features/support/utils/supportNotificationHandlers";

describe("extractSupportTicketId", () => {
  it("extrai ticket_id direto do payload WS", () => {
    expect(extractSupportTicketId({ ticket_id: 42 }, null)).toBe(42);
  });

  it("extrai support_message_id como fallback", () => {
    expect(extractSupportTicketId({ support_message_id: 7 }, null)).toBe(7);
  });

  it("prioriza detalhes da notificação persistida", () => {
    expect(
      extractSupportTicketId({}, { ticket_id: 99, type: "support_reply" }),
    ).toBe(99);
  });

  it("retorna null quando não há identificador válido", () => {
    expect(extractSupportTicketId({}, null)).toBeNull();
    expect(extractSupportTicketId({ ticket_id: 0 }, null)).toBeNull();
  });
});
