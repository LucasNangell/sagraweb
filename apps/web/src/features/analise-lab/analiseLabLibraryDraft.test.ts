import { describe, expect, it } from "vitest";

import type { ProblemaPadrao } from "@/features/analise/types";

import { buildLibraryDraft } from "./analiseLabLibraryDraft";

const baseProblema = (over: Partial<ProblemaPadrao> = {}): ProblemaPadrao => ({
  ID: 12,
  TituloPT: "Sangria insuficiente",
  ProbTecHTML: "<p>Texto do problema</p>",
  Categoria: "Miolo",
  ...over,
});

describe("buildLibraryDraft", () => {
  it("builds a draft from library problem without persisting", () => {
    const draft = buildLibraryDraft({
      problema: baseProblema(),
      escopo: "pagina",
      pagina: 7,
      pageSpec: "1-3",
    });
    expect(draft.idProblemaPadrao).toBe(12);
    expect(draft.titulo).toBe("Sangria insuficiente");
    expect(draft.escopo).toBe("pagina");
    expect(draft.pagina).toBe(7);
    expect(draft.paginas).toBe("7");
    expect(draft.htmlSnapshot).toContain("Texto do problema");
    expect(draft.id).toBeUndefined();
  });

  it("uses pageSpec for multi-page escopo", () => {
    const draft = buildLibraryDraft({
      problema: baseProblema({
        ID: 3,
        TituloPT: "Marca",
        ProbTecHTML: "<p>X</p>",
      }),
      escopo: "paginas",
      pagina: 2,
      pageSpec: "1-15,20",
    });
    expect(draft.pagina).toBe(1);
    expect(draft.paginas).toBe("1-15,20");
  });
});
