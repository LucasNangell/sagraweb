import { describe, expect, it } from "vitest";

import { discardProvaWebConfirmMessage } from "./ProvaWebPage";

describe("discardProvaWebConfirmMessage", () => {
  it("rascunho menciona arquivos e versão", () => {
    expect(discardProvaWebConfirmMessage(1, true, 1)).toContain("rascunho da Prova 1");
    expect(discardProvaWebConfirmMessage(1, true, 2)).not.toContain(
      "versão anterior",
    );
  });

  it("publicado avisa que o link deixa de funcionar", () => {
    const msg = discardProvaWebConfirmMessage(2, false, 1);
    expect(msg).toContain("Prova 2");
    expect(msg).toContain("link do cliente");
    expect(msg).not.toContain("versão anterior");
  });

  it("publicado com versão anterior avisa restauração", () => {
    expect(discardProvaWebConfirmMessage(2, false, 2)).toContain(
      "versão anterior voltará a ser a prova atual",
    );
  });
});
