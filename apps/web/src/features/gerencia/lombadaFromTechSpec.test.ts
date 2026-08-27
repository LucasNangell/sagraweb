import { describe, expect, it } from "vitest";

import { lombadaInputFromTechSpec } from "./lombadaFromTechSpec";
import type { TechSpec, TechSpecLote } from "./techSpec";

function lote(partial: Partial<TechSpecLote>): TechSpecLote {
  return {
    id: partial.id ?? "l",
    paginas: partial.paginas ?? 0,
    maquina_link: partial.maquina_link ?? "",
    papel_link: partial.papel_link ?? "",
    cores_link: partial.cores_link ?? "",
    papel_desc: partial.papel_desc ?? "",
    cores_desc: partial.cores_desc ?? "",
    frente_verso: partial.frente_verso ?? false,
    acabamentos: partial.acabamentos ?? [],
  };
}

describe("lombadaInputFromTechSpec", () => {
  it("preenche páginas do miolo e papéis da capa e do miolo", () => {
    const spec: TechSpec = {
      version: 1,
      componentes: [
        {
          nome: "Capa",
          tipo: "CAPA",
          lotes: [lote({ paginas: 4, papel_link: "Couché 250g" })],
        },
        {
          nome: "Miolo",
          tipo: "MIOLO",
          lotes: [lote({ paginas: 200, papel_link: "Offset 90" })],
        },
      ],
    };
    expect(lombadaInputFromTechSpec(spec)).toEqual({
      pgs: 200,
      capaPapel: "Couché 250g",
      mioloPapel: "Offset 90",
    });
  });

  it("usa Arquivo quando não há miolo", () => {
    const spec: TechSpec = {
      version: 1,
      componentes: [
        {
          nome: "Arquivo",
          lotes: [lote({ paginas: 80, papel_desc: "Pólen 80g" })],
        },
      ],
    };
    expect(lombadaInputFromTechSpec(spec)).toEqual({
      pgs: 80,
      capaPapel: null,
      mioloPapel: "Pólen 80g",
    });
  });

  it("soma as páginas das variações do miolo", () => {
    const spec: TechSpec = {
      version: 1,
      componentes: [
        {
          nome: "Miolo",
          tipo: "MIOLO",
          lotes: [
            lote({ id: "a", paginas: 160, papel_link: "Pólen 80g" }),
            lote({ id: "b", paginas: 40, papel_link: "Offset 90" }),
          ],
        },
      ],
    };
    expect(lombadaInputFromTechSpec(spec)).toEqual({
      pgs: 200,
      capaPapel: null,
      mioloPapel: "Pólen 80g",
    });
  });
});
