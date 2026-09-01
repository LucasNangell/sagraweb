import { describe, expect, it } from "vitest";

import {
  andamentosFromGrupoConfig,
  completeVinculoAndamentos,
  serializeVinculoAndamentos,
} from "./osVinculoAndamentos";

describe("completeVinculoAndamentos", () => {
  it("ignora vazios e deduplica ignorando maiúsculas", () => {
    expect(
      completeVinculoAndamentos([
        { situacao: "Recebido", setor: "SEFOC" },
        { situacao: "recebido", setor: "sefoc" },
        { situacao: "", setor: "SEIMP" },
        { situacao: "Saída p/", setor: "SEIMP" },
      ]),
    ).toEqual([
      { situacao: "Recebido", setor: "SEFOC" },
      { situacao: "Saída p/", setor: "SEIMP" },
    ]);
  });
});

describe("andamentosFromGrupoConfig", () => {
  it("usa a lista de andamentos quando presente", () => {
    expect(
      andamentosFromGrupoConfig({
        grupo_id: 1,
        situacao: "Recebido",
        setor: "SEFOC",
        membros: [],
        andamentos: [
          { situacao: "Recebido", setor: "SEFOC" },
          { situacao: "Saída p/", setor: "SEIMP" },
        ],
      }),
    ).toHaveLength(2);
  });

  it("cai no par legado situacao/setor", () => {
    expect(
      andamentosFromGrupoConfig({
        grupo_id: 1,
        situacao: "Saída p/",
        setor: "SEIMP",
        membros: [],
      }),
    ).toEqual([{ situacao: "Saída p/", setor: "SEIMP" }]);
  });
});

describe("serializeVinculoAndamentos", () => {
  it("é estável para comparação de dirty", () => {
    expect(
      serializeVinculoAndamentos([
        { situacao: "A", setor: "S" },
        { situacao: "B", setor: "T" },
      ]),
    ).toBe("A\0S|B\0T");
  });
});
