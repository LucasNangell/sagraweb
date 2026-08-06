import { describe, expect, it } from "vitest";

import type { SupportMessage, SupportThreadMessage } from "@/api/support";
import { mergeThreadMessageIntoTicket, normalizeSupportThreadMessage } from "@/features/support/utils/supportThreadCache";

function sampleTicket(thread: SupportThreadMessage[] = []): SupportMessage {
  return {
    Id: 1,
    Ponto: "918713",
    NomeUsuario: "Teste",
    Tipo: "problema",
    Assunto: "Assunto",
    Mensagem: "Corpo inicial",
    Status: "aberto",
    Resposta: null,
    RespondidoPor: null,
    DataCriacao: "2026-06-09T10:00:00",
    DataResposta: null,
    DataResolucao: null,
    ResolvidoPor: null,
    Thread: thread,
  };
}

function sampleMessage(id: number, text: string): SupportThreadMessage {
  return {
    Id: id,
    TicketId: 1,
    AutorTipo: "admin",
    AutorPonto: null,
    AutorNome: "Suporte",
    Mensagem: text,
    DataCriacao: "2026-06-09T11:00:00",
  };
}

describe("mergeThreadMessageIntoTicket", () => {
  it("adiciona mensagem nova ao cache existente", () => {
    const old = sampleTicket([sampleMessage(10, "Olá")]);
    const incoming = sampleMessage(11, "Resposta");

    const { ticket, result } = mergeThreadMessageIntoTicket(old, incoming);

    expect(result).toBe("appended");
    expect(ticket?.Thread).toHaveLength(2);
    expect(ticket?.Thread?.[1]?.Id).toBe(11);
  });

  it("ignora mensagem duplicada pelo Id", () => {
    const existing = sampleMessage(11, "Resposta");
    const old = sampleTicket([existing]);

    const { ticket, result } = mergeThreadMessageIntoTicket(old, existing);

    expect(result).toBe("duplicate");
    expect(ticket?.Thread).toHaveLength(1);
  });

  it("sinaliza cache_miss quando ticket ainda não está no cache", () => {
    const { ticket, result } = mergeThreadMessageIntoTicket(
      undefined,
      sampleMessage(11, "Resposta"),
    );

    expect(result).toBe("cache_miss");
    expect(ticket).toBeUndefined();
  });

  it("atualiza status quando ticket_status é resolvido", () => {
    const old = sampleTicket([]);
    const { ticket } = mergeThreadMessageIntoTicket(
      old,
      sampleMessage(12, "Encerrado"),
      "resolvido",
    );

    expect(ticket?.Status).toBe("resolvido");
  });

  it("normaliza message com chaves alternativas", () => {
    const normalized = normalizeSupportThreadMessage({
      id: 5,
      ticketId: 1,
      autorTipo: "admin",
      mensagem: "Oi",
    });
    expect(normalized?.Id).toBe(5);
    expect(normalized?.Mensagem).toBe("Oi");
  });
});
