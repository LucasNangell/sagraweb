import { describe, expect, it } from "vitest";

import {
  extractEmailsSimple,
  extractPontosSimple,
  normalizeContentId,
  prepareInboxEmailBody,
  prepareInboxEmailBodyParts,
  removeAllEmailImages,
  removeBrokenEmailImages,
  resolveInlineCidImages,
  splitInboxEmailThread,
} from "./utils";

describe("extractPontosSimple", () => {
  it("extrai ponto com 4 dígitos", () => {
    expect(extractPontosSimple("Falar com P_9187")).toEqual(["P_9187"]);
  });

  it("extrai ponto com 6 dígitos", () => {
    expect(extractPontosSimple("Responsável: P_918713")).toEqual(["P_918713"]);
  });

  it("ignora padrões inválidos", () => {
    expect(extractPontosSimple("P_123 ou P_1234567")).toEqual([]);
  });

  it("mantém extração de e-mail existente", () => {
    expect(extractEmailsSimple("contato@camara.leg.br")).toEqual([
      "contato@camara.leg.br",
    ]);
  });

  it("extrai múltiplos e-mails do texto de contato", () => {
    expect(
      extractEmailsSimple(
        "assessor@exemplo.com\ncontato@org.br; outro@teste.gov.br",
      ),
    ).toEqual(["assessor@exemplo.com", "contato@org.br", "outro@teste.gov.br"]);
  });
});

describe("normalizeContentId", () => {
  it("remove prefixo cid: e colchetes angulares", () => {
    expect(normalizeContentId("cid:<744183817@13042011-3547>")).toBe(
      "744183817@13042011-3547",
    );
  });
});

describe("resolveInlineCidImages", () => {
  it("substitui cid por URL de download", () => {
    const html =
      '<p>Olá</p><img src="cid:744183817@13042011-3547" alt="Descrição: teste">';
    const out = resolveInlineCidImages(
      html,
      "entry-1",
      { "744183817@13042011-3547": 2 },
      (entryId, index) => `/api/email/download?entry_id=${entryId}&att_index=${index}`,
    );
    expect(out).toContain(
      'src="/api/email/download?entry_id=entry-1&att_index=2"',
    );
    expect(out).not.toContain("cid:");
  });

  it("remove img quando cid não está mapeado", () => {
    const html = '<img src="cid:unknown@id">';
    const out = resolveInlineCidImages(html, "entry-1", {}, () => "");
    expect(out).toBe("");
  });
});

describe("removeBrokenEmailImages", () => {
  it("remove imagens com caminho local do Windows", () => {
    const html =
      '<img src="G:\\Administração\\Correio\\imagens\\icone.jpg" alt="Descrição: icone">';
    expect(removeBrokenEmailImages(html)).not.toContain("<img");
  });

  it("remove texto fallback Descrição com cid", () => {
    const html = "Descrição: Descrição: Descrição: cid:744183817@13042011-3547";
    expect(removeBrokenEmailImages(html)).not.toContain("cid:");
    expect(removeBrokenEmailImages(html)).not.toContain("Descrição:");
  });
});

describe("removeAllEmailImages", () => {
  it("remove todas as tags img, inclusive com URL válida", () => {
    const html =
      '<p>Texto</p><img src="https://example.com/a.png"><img src="cid:test@id">';
    expect(removeAllEmailImages(html)).not.toContain("<img");
    expect(removeAllEmailImages(html)).toContain("Texto");
  });
});

describe("splitInboxEmailThread", () => {
  it("separa resposta curta do bloco De:/Enviada em:/Para:/Assunto:", () => {
    const body =
      "<p>Impressão autorizada conforme Prova.</p>" +
      '<hr><div id="divRplyFwdMsg"><b>De:</b> Seção de Pré-Impressão' +
      "<br><b>Enviada em:</b> sexta-feira, 12 de junho de 2026" +
      "<br><b>Para:</b> Ana Claudia" +
      "<br><b>Assunto:</b> CGraf: Prova 1" +
      "</div><p>Corpo citado com imagens</p>";
    const { main, quoted } = splitInboxEmailThread(body);
    expect(main).toContain("Impressão autorizada");
    expect(main).not.toContain("De:");
    expect(quoted).toContain("De:");
    expect(quoted).toContain("Corpo citado");
  });

  it("retorna quoted null quando não há citação", () => {
    const body = "<p>Apenas uma mensagem simples.</p>";
    expect(splitInboxEmailThread(body)).toEqual({
      main: body,
      quoted: null,
    });
  });
});

describe("prepareInboxEmailBody", () => {
  it("remove imagens e mantém apenas texto da resposta", () => {
    const body =
      '<p>Resposta ok</p><img src="cid:img001@test">' +
      '<hr><div id="divRplyFwdMsg"><b>De:</b> X<br><b>Enviada em:</b> Y<br><b>Para:</b> Z<br><b>Assunto:</b> W</div>' +
      '<img src="G:\\local\\foto.jpg">';
    const out = prepareInboxEmailBody(body);
    expect(out).toContain("Resposta ok");
    expect(out).not.toContain("<img");
    expect(out).not.toContain("De:");
  });
});

describe("prepareInboxEmailBodyParts", () => {
  it("expõe citação separada para botão Ver mais", () => {
    const body =
      "<p>Resposta do usuário</p>" +
      '<hr><b>De:</b> Remetente<br><b>Enviada em:</b> data<br><b>Para:</b> dest<br><b>Assunto:</b> ass' +
      "<p>Texto antigo</p>";
    const parts = prepareInboxEmailBodyParts(body);
    expect(parts.main).toContain("Resposta do usuário");
    expect(parts.quoted).toContain("Texto antigo");
    expect(parts.main).not.toContain("<img");
    expect(parts.quoted).not.toContain("<img");
  });
});
