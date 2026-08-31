import { describe, expect, it } from "vitest";

import { createEmptyGerenciaForm } from "./defaults";
import {
  applyTechSpecToForm,
  buildDescAcabamentoFromTechSpec,
  buildPapelDescFromTechSpec,
  calculateCotaPagesFromTechSpec,
  calculateTotalPagesFromTechSpec,
  classifyCoresKind,
  computeComponentCalcs,
  createEmptyTechSpec,
  createGenericoComponente,
  ensureGenericoComponentes,
  ensureTechSpecIntegrity,
  inferImpressaoFromLote,
  impressaoAfterCoresChange,
  impressaoAfterFvChange,
  isGenericoComponente,
  parseLabeledMemo,
  specHasFrenteVerso,
  splitCapaMioloMaquina,
  type TechSpec,
  type TechSpecLote,
} from "./techSpec";

const capaSpec = {
  version: 1,
  componentes: [
    {
      nome: "Capa",
      tipo: "CAPA",
      lotes: [
        {
          id: "l1",
          paginas: 4,
          maquina_link: "Offset",
          papel_link: "Couché 150g",
          cores_link: "4x4",
          papel_desc: "",
          cores_desc: "",
          frente_verso: false,
        },
      ],
      acabamentos: [
        {
          catalog_id: 1,
          label: "Laminação",
          variacao_id: 2,
          variacao_label: "Fosca",
        },
        { catalog_id: 3, label: "Grampo" },
      ],
    },
  ],
} as TechSpec;

function lote(partial: Partial<TechSpecLote>): TechSpecLote {
  return {
    id: partial.id ?? "l",
    paginas: partial.paginas ?? 0,
    maquina_link: partial.maquina_link ?? "",
    papel_link: partial.papel_link ?? "",
    cores_link: partial.cores_link ?? "",
    papel_desc: partial.papel_desc ?? "",
    cores_desc: partial.cores_desc ?? "",
    impressao: partial.impressao ?? "",
    frente_verso: partial.frente_verso ?? false,
    acabamentos: partial.acabamentos ?? [],
  };
}

describe("Arquivo", () => {
  it("cria Arquivo quando o spec está vazio e hidrata campos da OS", () => {
    const form = {
      ...createEmptyGerenciaForm(),
      val_pgs: "12",
      val_papel: "Offset 90",
      val_cores: "P/B",
      val_maquina: "Digital",
      txt_acabamento: "Dobra manual",
    };
    const spec = ensureGenericoComponentes(createEmptyTechSpec(), form);
    expect(spec.componentes).toHaveLength(1);
    expect(isGenericoComponente(spec.componentes[0])).toBe(true);
    expect(spec.componentes[0].lotes[0].paginas).toBe(12);
    expect(spec.componentes[0].lotes[0].papel_link).toBe("Offset 90");
    expect(spec.acabamentosGerais?.[0]?.label).toBe("Dobra manual");
    expect(spec.componentes[0].lotes[0].acabamentos).toEqual([]);
    expect(buildDescAcabamentoFromTechSpec(spec)).toBe("Dobra manual");
  });

  it("não substitui componentes já existentes", () => {
    const spec = ensureGenericoComponentes(capaSpec);
    expect(spec.componentes[0].tipo).toBe("CAPA");
    expect(spec.componentes.some(isGenericoComponente)).toBe(false);
  });
});

describe("parser de memos MDB", () => {
  it("quebra Capa/Miolo em newlines", () => {
    expect(parseLabeledMemo("Capa: CF 250g\nMiolo: CF 115g")).toEqual([
      { tipo: "CAPA", nome: "Capa", value: "CF 250g" },
      { tipo: "MIOLO", nome: "Miolo", value: "CF 115g" },
    ]);
  });

  it("hidrata PapelDescricao em dois componentes e faz round-trip fiel", () => {
    const form = {
      ...createEmptyGerenciaForm(),
      txt_papel_desc: "Capa: CF 250g\nMiolo: CF 115g",
      txt_acabamento: "Laminação fosca",
    };
    const spec = ensureGenericoComponentes(createEmptyTechSpec(), form);
    expect(spec.componentes.map((c) => c.tipo)).toEqual(["CAPA", "MIOLO"]);
    expect(spec.componentes[0].lotes[0].papel_desc).toBe("CF 250g");
    expect(spec.componentes[1].lotes[0].papel_desc).toBe("CF 115g");
    expect(spec.acabamentosGerais?.[0]?.label).toBe("Laminação fosca");
    expect(buildPapelDescFromTechSpec(spec)).toBe("Capa: CF 250g | Miolo: CF 115g");
    expect(buildDescAcabamentoFromTechSpec(spec)).toBe("Laminação fosca");
  });

  it("reparte Arquivo cujo desc ainda tem rótulos Capa/Miolo", () => {
    const spec = ensureGenericoComponentes(
      {
        version: 1,
        componentes: [
          createGenericoComponente({
            papelDesc: "Capa: Couchê 250g | Miolo: Offset 90g",
          }),
        ],
      },
      createEmptyGerenciaForm(),
    );
    expect(spec.componentes.map((c) => c.tipo)).toEqual(["CAPA", "MIOLO"]);
    expect(spec.componentes[0].lotes[0].papel_desc).toContain("Couchê 250g");
    expect(spec.componentes[1].lotes[0].papel_desc).toContain("Offset 90g");
  });

  it("texto sem rótulo permanece no Arquivo", () => {
    const spec = ensureGenericoComponentes(createEmptyTechSpec(), {
      ...createEmptyGerenciaForm(),
      txt_papel_desc: "Sulfite 75g extra branco",
    });
    expect(spec.componentes).toHaveLength(1);
    expect(isGenericoComponente(spec.componentes[0])).toBe(true);
    expect(spec.componentes[0].lotes[0].papel_desc).toBe("Sulfite 75g extra branco");
  });
});

describe("F/V por lote", () => {
  it("OS FrenteVerso=1 sem flag no JSON marca todos os lotes", () => {
    const spec = ensureGenericoComponentes(capaSpec, {
      ...createEmptyGerenciaForm(),
      chk_fv: true,
    });
    expect(spec.componentes[0].lotes[0].frente_verso).toBe(true);
    expect(specHasFrenteVerso(spec)).toBe(true);
  });

  it("applyTechSpecToForm define chk_fv se qualquer lote for F/V", () => {
    const spec: TechSpec = {
      version: 1,
      componentes: [
        {
          nome: "Capa",
          tipo: "CAPA",
          lotes: [
            {
              id: "a",
              paginas: 4,
              maquina_link: "",
              papel_link: "",
              cores_link: "",
              papel_desc: "",
              cores_desc: "",
              frente_verso: true,
              acabamentos: [],
            },
          ],
        },
        {
          nome: "Miolo",
          tipo: "MIOLO",
          lotes: [
            {
              id: "b",
              paginas: 16,
              maquina_link: "",
              papel_link: "",
              cores_link: "",
              papel_desc: "",
              cores_desc: "",
              frente_verso: false,
              acabamentos: [],
            },
          ],
        },
      ],
    };
    const form = applyTechSpecToForm(createEmptyGerenciaForm(), spec);
    expect(form.chk_fv).toBe(true);
  });
});

describe("flatten para colunas Access", () => {
  it("com Arquivo usa só o DescAcabamento geral, sem rótulo por componente", () => {
    const spec: TechSpec = {
      version: 1,
      componentes: [
        createGenericoComponente({ paginas: 8 }),
        {
          nome: "Capa",
          tipo: "CAPA",
          lotes: [
            {
              id: "l1",
              paginas: 4,
              maquina_link: "",
              papel_link: "",
              cores_link: "",
              papel_desc: "",
              cores_desc: "",
              frente_verso: false,
              acabamentos: [{ label: "Grampo" }],
            },
          ],
        },
      ],
      acabamentosGerais: [{ label: "Laminação fosca" }],
    };
    expect(buildDescAcabamentoFromTechSpec(spec)).toBe("Laminação fosca");
  });

  it("reaproveita memo antigo gravado como Arquivo: …", () => {
    const spec = ensureGenericoComponentes(createEmptyTechSpec(), {
      ...createEmptyGerenciaForm(),
      txt_acabamento: "Arquivo:\n  Dobra manual",
    });
    expect(spec.acabamentosGerais?.[0]?.label).toBe("Dobra manual");
    expect(buildDescAcabamentoFromTechSpec(spec)).toBe("Dobra manual");
  });

  it("agrega acabamentos no texto DescAcabamento", () => {
    expect(buildDescAcabamentoFromTechSpec(capaSpec)).toBe(
      "Capa:\n  Laminação Fosca\n  Grampo",
    );
  });

  it("JSON antigo no componente migra para o primeiro lote", () => {
    const migrated = ensureTechSpecIntegrity(capaSpec);
    expect(migrated.componentes[0].lotes[0].acabamentos.map((a) => a.label)).toEqual(
      ["Laminação", "Grampo"],
    );
  });

  it("applyTechSpecToForm preenche Pags, papel, máquina e acabamento", () => {
    const form = applyTechSpecToForm(createEmptyGerenciaForm(), capaSpec);
    expect(form.val_pgs).toBe("4");
    expect(form.val_papel).toBe("Couché 150g");
    expect(form.val_maquina).toBe("Offset");
    expect(form.val_cores).toBe("4x4");
    expect(form.txt_acabamento).toBe("Capa:\n  Laminação Fosca\n  Grampo");
  });

  it("inclui a obs do acabamento no texto agregado", () => {
    const withObs: TechSpec = {
      version: 1,
      componentes: [
        {
          nome: "Capa",
          tipo: "CAPA",
          lotes: [
            {
              id: "l1",
              paginas: 4,
              maquina_link: "",
              papel_link: "",
              cores_link: "",
              papel_desc: "",
              cores_desc: "",
              frente_verso: false,
              acabamentos: [
                {
                  catalog_id: 1,
                  label: "Laminação",
                  variacao_id: 2,
                  variacao_label: "Fosca",
                  obs: "corte especial",
                },
              ],
            },
          ],
        },
      ],
    };
    expect(buildDescAcabamentoFromTechSpec(withObs)).toBe(
      "Capa:\n  Laminação Fosca (corte especial)",
    );
  });
});

describe("campos OS de máquina, papel e cores", () => {
  const mixedSpec: TechSpec = {
    version: 1,
    componentes: [
      {
        nome: "Capa",
        tipo: "CAPA",
        lotes: [
          lote({
            id: "c",
            paginas: 4,
            maquina_link: "Offset",
            papel_link: "Couché 250g",
            cores_link: "4x4",
          }),
        ],
      },
      {
        nome: "Miolo",
        tipo: "MIOLO",
        lotes: [
          lote({
            id: "m",
            paginas: 16,
            maquina_link: "Digital",
            papel_link: "Pólen 80g",
            cores_link: "1x1",
          }),
        ],
      },
    ],
  };

  it("grava máquinas distintas como Maquina1/Maquina2", () => {
    const form = applyTechSpecToForm(createEmptyGerenciaForm(), mixedSpec);
    expect(form.val_maquina).toBe("Offset/Digital");
  });

  it("grava PapelLink Diversos e Cores Diversas sem alterar as descrições", () => {
    const form = applyTechSpecToForm(createEmptyGerenciaForm(), mixedSpec);
    expect(form.val_papel).toBe("Diversos");
    expect(form.val_cores).toBe("Diversas");
    expect(form.txt_papel_desc).toBe("Capa: Couché 250g | Miolo: Pólen 80g");
    expect(form.txt_cores_desc).toBe("Capa: 4x4 | Miolo: 1x1");
  });

  it("mantém o valor único quando todos os componentes coincidem", () => {
    const same: TechSpec = {
      version: 1,
      componentes: [
        {
          nome: "Capa",
          tipo: "CAPA",
          lotes: [lote({ id: "c", maquina_link: "Offset", papel_link: "Pólen", cores_link: "1x1" })],
        },
        {
          nome: "Miolo",
          tipo: "MIOLO",
          lotes: [lote({ id: "m", maquina_link: "Offset", papel_link: "Pólen", cores_link: "1x1" })],
        },
      ],
    };
    const form = applyTechSpecToForm(createEmptyGerenciaForm(), same);
    expect(form.val_maquina).toBe("Offset");
    expect(form.val_papel).toBe("Pólen");
    expect(form.val_cores).toBe("1x1");
  });
});

describe("createGenericoComponente", () => {
  it("usa o nome Arquivo sem tipo legado", () => {
    const comp = createGenericoComponente();
    expect(comp.nome).toBe("Arquivo");
    expect(comp.tipo).toBeUndefined();
  });

  it("reconhece o nome legado Genérico como o mesmo componente", () => {
    expect(
      isGenericoComponente({ nome: "Genérico", lotes: [] }),
    ).toBe(true);
    expect(
      ensureTechSpecIntegrity({
        version: 1,
        componentes: [{ nome: "Genérico", lotes: [] }],
      }).componentes[0].nome,
    ).toBe("Arquivo");
  });
});

describe("Capa verso em branco", () => {
  const capa4Color = (versoEmBranco: boolean): TechSpec => ({
    version: 1,
    componentes: [
      {
        nome: "Capa",
        tipo: "CAPA",
        verso_em_branco: versoEmBranco,
        lotes: [
          lote({
            id: "c",
            paginas: 4,
            cores_link: "4x4",
            papel_link: "Couché 250g",
            maquina_link: "Offset",
          }),
        ],
      },
    ],
  });

  it("mantém 4 páginas físicas e conta 2 na cota", () => {
    const spec = capa4Color(true);
    expect(calculateTotalPagesFromTechSpec(spec)).toBe(4);
    expect(calculateCotaPagesFromTechSpec(spec)).toBe(2);
    const calcs = computeComponentCalcs(spec);
    expect(calcs[0].color).toBe(2);
    expect(calcs[0].total).toBe(2);
  });

  it("não altera a cota quando a opção está desmarcada", () => {
    const spec = capa4Color(false);
    expect(calculateCotaPagesFromTechSpec(spec)).toBe(4);
    expect(computeComponentCalcs(spec)[0].color).toBe(4);
  });

  it("grava calc da capa com 2 páginas e Pags da OS com 4", () => {
    const form = applyTechSpecToForm(createEmptyGerenciaForm(), capa4Color(true));
    expect(form.val_pgs).toBe("4");
    expect(form.calc_capa_color).toBe("2");
  });

  it("migra verso_em_branco para impressao 4/0 e deixa de gravar o flag", () => {
    const migrated = ensureTechSpecIntegrity(capa4Color(true));
    expect(migrated.componentes[0].verso_em_branco).toBeUndefined();
    expect(migrated.componentes[0].lotes[0].impressao).toBe("4/0");
    expect(migrated.componentes[0].lotes[0].frente_verso).toBe(false);
    expect(calculateCotaPagesFromTechSpec(migrated)).toBe(2);
  });
});

describe("Impressão N/M", () => {
  it("infere 4/4, 4/0, 1/1 e 1/0 a partir do catálogo e F/V", () => {
    expect(
      inferImpressaoFromLote({
        cores_link: "4x4",
        cores_desc: "",
        frente_verso: true,
        impressao: "",
      }),
    ).toBe("4/4");
    expect(
      inferImpressaoFromLote({
        cores_link: "Policromia",
        cores_desc: "",
        frente_verso: false,
        impressao: "",
      }),
    ).toBe("4/0");
    expect(
      inferImpressaoFromLote({
        cores_link: "P/B",
        cores_desc: "",
        frente_verso: true,
        impressao: "",
      }),
    ).toBe("1/1");
    expect(
      inferImpressaoFromLote({
        cores_link: "P/B",
        cores_desc: "",
        frente_verso: false,
        impressao: "",
      }),
    ).toBe("1/0");
  });

  it("ao mudar F/V só ajusta o verso", () => {
    expect(
      impressaoAfterFvChange(
        { impressao: "4/4", cores_link: "4x4", cores_desc: "" },
        false,
      ),
    ).toBe("4/0");
    expect(
      impressaoAfterFvChange(
        { impressao: "1/0", cores_link: "P/B", cores_desc: "" },
        true,
      ),
    ).toBe("1/1");
  });

  it("ao mudar cores 4x4/P/B atualiza N/M", () => {
    expect(
      impressaoAfterCoresChange({ impressao: "1/0", frente_verso: false }, "4x4"),
    ).toBe("4/4");
    expect(
      impressaoAfterCoresChange({ impressao: "4/4", frente_verso: true }, "P/B"),
    ).toBe("1/1");
  });

  it("classifyCoresKind reconhece 1/1 e 4/0; 2/3 não é policromia", () => {
    expect(classifyCoresKind("1/1")).toBe("PB");
    expect(classifyCoresKind("1/0")).toBe("PB");
    expect(classifyCoresKind("4/0")).toBe("COLOR");
    expect(classifyCoresKind("2/3")).toBeNull();
  });

  it("capa 4p em 4/0 conta 2 na cota mesmo sem o flag legado", () => {
    const spec: TechSpec = {
      version: 1,
      componentes: [
        {
          nome: "Capa",
          tipo: "CAPA",
          lotes: [
            lote({
              id: "c",
              paginas: 4,
              cores_link: "4x4",
              impressao: "4/0",
            }),
          ],
        },
      ],
    };
    expect(calculateTotalPagesFromTechSpec(spec)).toBe(4);
    expect(calculateCotaPagesFromTechSpec(spec)).toBe(2);
    expect(computeComponentCalcs(spec)[0].color).toBe(2);
  });
});

describe("máquina Capa/Miolo com barra", () => {
  it("reparte Digital Cor/PB herdando o prefixo Digital", () => {
    expect(splitCapaMioloMaquina("Digital Cor/PB")).toEqual({
      capa: "Digital Cor",
      miolo: "Digital PB",
    });
  });

  it("reparte códigos completos PM52/SM74", () => {
    expect(splitCapaMioloMaquina("PM52/SM74")).toEqual({
      capa: "PM52",
      miolo: "SM74",
    });
  });

  it("não herda prefixo quando o lado direito já é um código com dígito", () => {
    expect(splitCapaMioloMaquina("Digital Cor/SM74")).toEqual({
      capa: "Digital Cor",
      miolo: "SM74",
    });
  });

  it("hidrata capa e miolo a partir do campo Máquina da OS", () => {
    const spec = ensureGenericoComponentes(createEmptyTechSpec(), {
      ...createEmptyGerenciaForm(),
      val_maquina: "Digital Cor/PB",
      txt_papel_desc: "Capa: CF 250g\nMiolo: Offset 90g",
    });
    expect(spec.componentes.find((c) => c.tipo === "CAPA")?.lotes[0].maquina_link).toBe(
      "Digital Cor",
    );
    expect(spec.componentes.find((c) => c.tipo === "MIOLO")?.lotes[0].maquina_link).toBe(
      "Digital PB",
    );
  });

  it("divide o valor combinado já gravado nos lotes", () => {
    const spec = ensureGenericoComponentes(
      {
        version: 1,
        componentes: [
          {
            nome: "Capa",
            tipo: "CAPA",
            lotes: [lote({ id: "c", paginas: 4, maquina_link: "PM52/SM74" })],
          },
          {
            nome: "Miolo",
            tipo: "MIOLO",
            lotes: [lote({ id: "m", paginas: 16, maquina_link: "PM52/SM74" })],
          },
        ],
      },
      { ...createEmptyGerenciaForm(), val_maquina: "PM52/SM74" },
    );
    expect(spec.componentes[0].lotes[0].maquina_link).toBe("PM52");
    expect(spec.componentes[1].lotes[0].maquina_link).toBe("SM74");
  });

  it("não sobrescreve máquinas já distintas", () => {
    const spec = ensureGenericoComponentes(
      {
        version: 1,
        componentes: [
          {
            nome: "Capa",
            tipo: "CAPA",
            lotes: [lote({ id: "c", paginas: 4, maquina_link: "Offset" })],
          },
          {
            nome: "Miolo",
            tipo: "MIOLO",
            lotes: [lote({ id: "m", paginas: 16, maquina_link: "Digital" })],
          },
        ],
      },
      { ...createEmptyGerenciaForm(), val_maquina: "Offset/Digital" },
    );
    expect(spec.componentes[0].lotes[0].maquina_link).toBe("Offset");
    expect(spec.componentes[1].lotes[0].maquina_link).toBe("Digital");
  });
});
