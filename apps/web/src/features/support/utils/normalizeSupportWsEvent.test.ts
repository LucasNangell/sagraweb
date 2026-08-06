import { describe, expect, it } from "vitest";

import { normalizeSupportWsEvent } from "@/features/support/utils/normalizeSupportWsEvent";

describe("normalizeSupportWsEvent", () => {
  it("extrai ticket_id da raiz", () => {
    const event = normalizeSupportWsEvent({
      type: "support_chat_message",
      ticket_id: 4,
      message_id: 99,
      message: {
        Id: 99,
        TicketId: 4,
        AutorTipo: "admin",
        AutorPonto: null,
        AutorNome: "Suporte",
        Mensagem: "Olá",
        DataCriacao: null,
      },
    });
    expect(event.ticketId).toBe(4);
    expect(event.messageId).toBe(99);
    expect(event.message?.Mensagem).toBe("Olá");
  });

  it("extrai ticket_id de payload aninhado", () => {
    const event = normalizeSupportWsEvent({
      type: "notification_new",
      action: "support_reply",
      payload: { ticket_id: 7, support_message_id: 7 },
    });
    expect(event.ticketId).toBe(7);
    expect(event.action).toBe("support_reply");
  });

  it("extrai ticket_id de detalhes JSON string", () => {
    const event = normalizeSupportWsEvent({
      type: "notification_new",
      action: "support_incoming",
      ticket_id: 12,
      detalhes: JSON.stringify({ ticket_id: 12, type: "support_incoming" }),
    });
    expect(event.ticketId).toBe(12);
  });

  it("extrai ticketId de message.TicketId quando raiz ausente", () => {
    const event = normalizeSupportWsEvent({
      type: "support_chat_message",
      message: {
        Id: 5,
        TicketId: 4,
        AutorTipo: "admin",
        Mensagem: "teste",
      },
    });
    expect(event.ticketId).toBe(4);
    expect(event.messageId).toBe(5);
  });

  it("ignora pong e não marca como evento de suporte", () => {
    const event = normalizeSupportWsEvent({ type: "pong" });
    expect(event.isSupportEvent).toBe(false);
    expect(event.ticketId).toBeNull();
  });

  it("normaliza support_chat_typing", () => {
    const event = normalizeSupportWsEvent({
      type: "support_chat_typing",
      ticket_id: 4,
      author_role: "admin",
      author_label: "João",
      typing: true,
    });
    expect(event.ticketId).toBe(4);
    expect(event.authorRole).toBe("admin");
    expect(event.typing).toBe(true);
  });
});
