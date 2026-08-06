import { describe, expect, it } from "vitest";

import {
  GRAVACAO_EXTERNA_SITUACAO,
  GRAVACAO_PENDENTE_SITUACAO,
  canAlterarArquivosGravacaoExterna,
  canAlterarArquivosGravacaoPendente,
  isGravacaoExternaFile,
  isGravacaoPendenteSituacao,
} from "@/features/gravacao-externa/constants";

describe("gravacao-externa constants", () => {
  it("recognizes pdf and tif extensions", () => {
    expect(isGravacaoExternaFile("arquivo.pdf")).toBe(true);
    expect(isGravacaoExternaFile("scan.TIF")).toBe(true);
    expect(isGravacaoExternaFile("scan.tiff")).toBe(true);
    expect(isGravacaoExternaFile("doc.docx")).toBe(false);
  });

  it("uses expected situacao label", () => {
    expect(GRAVACAO_EXTERNA_SITUACAO).toBe("Gravação Externa");
  });

  it("recognizes gravacao pendente situacao", () => {
    expect(GRAVACAO_PENDENTE_SITUACAO).toBe("Gravação Pendente");
    expect(isGravacaoPendenteSituacao("Gravação Pendente")).toBe(true);
    expect(isGravacaoPendenteSituacao("Gravação Externa")).toBe(false);
    expect(isGravacaoPendenteSituacao(null)).toBe(false);
  });

  it("allows alterar arquivos only before gravacao starts", () => {
    expect(canAlterarArquivosGravacaoExterna({ status: "pendente" })).toBe(true);
    expect(canAlterarArquivosGravacaoExterna({ status: "iniciada" })).toBe(false);
    expect(canAlterarArquivosGravacaoPendente({ status: "ativa" })).toBe(true);
    expect(canAlterarArquivosGravacaoPendente({ status: "enviada" })).toBe(false);
  });
});
