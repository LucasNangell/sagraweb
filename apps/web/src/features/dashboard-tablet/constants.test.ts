import { describe, expect, it } from "vitest";

import {
  isEntregueSituacao,
  isPrimaryAndamento,
  requiresDestinoSetor,
  requiresProtocoloEntrega,
  sortPtBr,
  TABLET_DEFAULT_SETORES,
  TABLET_DESKTOP_ONLY_SITUACOES,
  TABLET_FROZEN_SITUACOES,
  TABLET_PRIMARY_ANDAMENTOS,
} from "./constants";

describe("dashboard-tablet constants", () => {
  it("requiresDestinoSetor reconhece prefixos de saída/tramitação", () => {
    expect(requiresDestinoSetor("Saída p/")).toBe(true);
    expect(requiresDestinoSetor("Saída p/ SEFOC")).toBe(true);
    expect(requiresDestinoSetor("Saída parcial p/")).toBe(true);
    expect(requiresDestinoSetor("Tramit. de Prévia p/")).toBe(true);
    expect(requiresDestinoSetor("Tramit. de Prova p/")).toBe(true);
    expect(requiresDestinoSetor("Recebido")).toBe(false);
    expect(requiresDestinoSetor("Em Execução")).toBe(false);
  });

  it("setores padrão ordenam alfabeticamente em pt-BR", () => {
    const sorted = sortPtBr([...TABLET_DEFAULT_SETORES]);
    expect(sorted[0]).toBe("Correspondência");
    expect(sorted).toContain("SEFOC");
    expect(sorted).toContain("Expedição");
  });

  it("Entregue é lançável no tablet e primário", () => {
    expect(TABLET_DESKTOP_ONLY_SITUACOES.has("Entregue")).toBe(false);
    expect(isPrimaryAndamento("Entregue")).toBe(true);
    expect(TABLET_PRIMARY_ANDAMENTOS).toContain("Entregue");
    expect(requiresProtocoloEntrega("Entregue")).toBe(true);
    expect(isEntregueSituacao("Entregue")).toBe(true);
  });

  it("OS já Entregue continua congelada", () => {
    expect(TABLET_FROZEN_SITUACOES.has("Entregue")).toBe(true);
    expect(TABLET_FROZEN_SITUACOES.has("Cancelada")).toBe(true);
    expect(TABLET_FROZEN_SITUACOES.has("Cancelado")).toBe(true);
  });

  it("Cancelada e Gravação Pendente seguem desktop-only", () => {
    expect(TABLET_DESKTOP_ONLY_SITUACOES.has("Cancelada")).toBe(true);
    expect(TABLET_DESKTOP_ONLY_SITUACOES.has("Cancelado")).toBe(true);
    expect(TABLET_DESKTOP_ONLY_SITUACOES.has("Gravação Pendente")).toBe(true);
  });
});
