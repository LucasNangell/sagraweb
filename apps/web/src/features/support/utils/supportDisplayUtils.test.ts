import { describe, expect, it } from "vitest";

import type { SupportMessage } from "@/api/support";
import { supportTicketPreview } from "@/features/support/utils/supportDisplayUtils";

function ticket(partial: Partial<SupportMessage>): SupportMessage {
  return {
    Id: 1,
    Ponto: "918713",
    NomeUsuario: "Teste",
    Tipo: "problema",
    Assunto: "Assunto",
    Mensagem: "Mensagem inicial longa do ticket",
    Status: "aberto",
    Resposta: null,
    RespondidoPor: null,
    DataCriacao: null,
    DataResposta: null,
    DataResolucao: null,
    ResolvidoPor: null,
    Thread: [],
    ...partial,
  };
}

describe("supportTicketPreview", () => {
  it("usa última mensagem da thread com prefixo do suporte", () => {
    const preview = supportTicketPreview(
      ticket({
        Thread: [
          {
            Id: 1,
            TicketId: 1,
            AutorTipo: "usuario",
            AutorPonto: "918713",
            AutorNome: "Teste",
            Mensagem: "Olá",
            DataCriacao: null,
          },
          {
            Id: 2,
            TicketId: 1,
            AutorTipo: "admin",
            AutorPonto: null,
            AutorNome: "Suporte",
            Mensagem: "Resposta do admin",
            DataCriacao: null,
          },
        ],
      }),
    );
    expect(preview).toBe("Suporte: Resposta do admin");
  });

  it("usa corpo inicial quando não há thread", () => {
    expect(supportTicketPreview(ticket({}))).toBe("Mensagem inicial longa do ticket");
  });
});
