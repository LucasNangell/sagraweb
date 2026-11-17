import { describe, expect, it } from "vitest";

import {
  cdrCamposEmLeitura,
  cdrDisponivel,
  computeCdrAlteracoes,
  formatTempoRelativo,
  pickCdrCampos,
} from "./cdrCampos";
import type { PapelariaOsCdrCampos } from "./types";

const data: PapelariaOsCdrCampos = {
  status: "ready",
  atualizado: true,
  tem_retrato: true,
  arquivo: { filename: "a.cdr", relative_path: "Sefoc/a.cdr", mtime: 1, size: 10 },
  files: [{ filename: "a.cdr", relative_path: "Sefoc/a.cdr", mtime: 1 }],
  campos: [
    {
      key: "cdr:Nome",
      nome: "Nome",
      label: "Nome",
      pagina: null,
      texto: "Fulano",
      multiline: false,
      alvos: [{ static_id: 1, pagina: 1 }],
    },
  ],
  sem_nome: [
    {
      key: "cdr#1:3",
      static_id: 3,
      pagina: 1,
      texto: "Rua A",
      camada: "Camada 1",
      multiline: false,
    },
  ],
  total_objetos: 2,
  erro: null,
  extraido_em: null,
  solicitado_em: null,
};

describe("computeCdrAlteracoes", () => {
  it("ignora valores iguais ao retrato", () => {
    const out = computeCdrAlteracoes(data, { "cdr:Nome": "Fulano" }, {});
    expect(out.count).toBe(0);
  });

  it("inclui texto alterado e nome novo de texto sem nome", () => {
    const out = computeCdrAlteracoes(
      data,
      { "cdr:Nome": "Beltrano" },
      { "cdr#1:3": { nome: "  Endereco ", texto: "Rua A" } },
    );
    expect(out.textos).toEqual({ "cdr:Nome": "Beltrano" });
    expect(out.semNome).toEqual([{ static_id: 3, pagina: 1, nome: "Endereco" }]);
    expect(out.count).toBe(2);
  });

  it("sem retrato não gera alterações", () => {
    expect(computeCdrAlteracoes(undefined, { "cdr:Nome": "x" }, {}).count).toBe(0);
  });
});

describe("helpers", () => {
  it("pickCdrCampos filtra só chaves cdr:", () => {
    expect(pickCdrCampos({ "cdr:Nome": "A", nome_deputado: "B" })).toEqual({
      "cdr:Nome": "A",
    });
  });

  it("status de leitura e disponibilidade", () => {
    expect(cdrCamposEmLeitura({ ...data, status: "pending" })).toBe(true);
    expect(cdrCamposEmLeitura(data)).toBe(false);
    expect(cdrDisponivel({ ...data, status: "sem_cdr" })).toBe(false);
    expect(cdrDisponivel(data)).toBe(true);
  });

  it("formatTempoRelativo", () => {
    const now = Date.parse("2026-11-17T12:00:00Z");
    expect(formatTempoRelativo("2026-11-17T11:59:30Z", now)).toBe("agora há pouco");
    expect(formatTempoRelativo("2026-11-17T11:30:00Z", now)).toBe("há 30 min");
    expect(formatTempoRelativo(null, now)).toBe("");
  });
});
