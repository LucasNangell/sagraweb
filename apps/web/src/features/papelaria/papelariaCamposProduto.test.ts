import { describe, expect, it } from "vitest";

import {
  camposModeloComProduto,
  camposVisiveis,
  chaveEscolha,
  construirCamposProduto,
  escolhasIniciais,
  escolherTodos,
  normalizarTextoCorel,
  previewConfigComProduto,
  semValoresDoProduto,
} from "./papelariaCamposProduto";
import type { PapelariaCorelDiferenca, PapelariaField } from "./types";

// Diferenças reais do 06592 CtVisita (Corel antigo × formulário).
const DIFERENCAS: PapelariaCorelDiferenca[] = [
  {
    campo: "NomeDep",
    rotulo: "Nome do deputado/deputada",
    editavel: true,
    original: [],
    novo: [],
    ocorrencias: [
      { face: "Frente", x: 42.22, y: 28.36, rotulo: "Frente", original: "Sargento Gonçalves", novo: "Sargento Gonçalves" },
      { face: "Verso", x: 23.46, y: 25, rotulo: "Verso", original: "Everton Rocha\nChefe de Gabinete", novo: "Sargento Gonçalves" },
    ],
  },
  {
    campo: "Endereco",
    rotulo: "Endereco",
    editavel: true,
    original: [],
    novo: [],
    ocorrencias: [
      { face: "Frente", x: 65.89, y: 12.18, rotulo: "Frente (direita)", original: "Av. das Fronteiras, 1251\nNatal/RN", novo: "Câmara dos Deputados\nAnexo IV" },
      { face: "Frente", x: 17.69, y: 12.18, rotulo: "Frente (esquerda)", original: "Câmara dos Deputados\nAnexo III", novo: "Câmara dos Deputados\nAnexo IV" },
    ],
  },
  {
    campo: "Contato",
    rotulo: "Contato",
    editavel: true,
    original: [],
    novo: [],
    ocorrencias: [
      { face: "Frente", x: 42.5, y: 4.17, rotulo: "Frente", original: "dep@camara.leg.br", novo: "Fones: (61) 3215-5569\ndep@camara.leg.br" },
    ],
  },
];

const CAMPOS_MODELO = {
  Contato: "Fones: (61) 3215-5{gabinete}\n{email}",
  Endereco: "Câmara dos Deputados\nAnexo {anexo}, Gabinete {gabinete}",
  NomeDep: "{nome_deputado}",
  PartidoDep: "{partido}/{uf}",
};
const FORM: PapelariaField[] = [
  { key: "nome_deputado", label: "Nome", type: "text", required: true },
  { key: "anexo", label: "Anexo", type: "text" },
  { key: "gabinete", label: "Gabinete", type: "text" },
  { key: "email", label: "E-mail", type: "email" },
  { key: "partido", label: "Partido", type: "text" },
  { key: "uf", label: "UF", type: "text" },
];

describe("normalizarTextoCorel", () => {
  it("trata quebras do Corel e espaços", () => {
    expect(normalizarTextoCorel("  A\r B  \u000bC\r\r")).toBe("A\nB\nC");
  });
});

describe("escolhas do modal", () => {
  it("começa com o texto do Corel e permite trocar tudo", () => {
    const ini = escolhasIniciais(DIFERENCAS);
    expect(ini[chaveEscolha("NomeDep", 1)]).toBe("Everton Rocha\nChefe de Gabinete");
    const form = escolherTodos(DIFERENCAS, "novo");
    expect(form[chaveEscolha("Contato", 0)]).toContain("Fones");
  });
});

describe("construirCamposProduto", () => {
  it("manter o Corel cria um campo por ocorrência (face e posição)", () => {
    const { camposProduto, valores } = construirCamposProduto(
      DIFERENCAS,
      escolhasIniciais(DIFERENCAS),
      { arquivo: "06592_Base.cdr" },
    );
    expect(camposProduto?.arquivo).toBe("06592_Base.cdr");
    expect(Object.keys(camposProduto!.objetos)).toEqual(["NomeDep", "Endereco", "Contato"]);
    const nome = camposProduto!.objetos.NomeDep;
    expect(nome.map((e) => e.face)).toEqual(["Frente", "Verso"]);
    expect(valores[nome[1].key]).toBe("Everton Rocha\nChefe de Gabinete");
    expect(camposProduto!.campos.map((c) => c.label)).toContain("Endereco — Frente (direita)");
    expect(new Set(camposProduto!.campos.map((c) => c.key)).size).toBe(5);
  });

  it("usar tudo do formulário não cria campos do produto", () => {
    const { camposProduto } = construirCamposProduto(
      DIFERENCAS,
      escolherTodos(DIFERENCAS, "novo"),
    );
    expect(camposProduto).toBeNull();
  });

  it("edição no modal vira o valor do campo e preserva chaves existentes", () => {
    const comChave = DIFERENCAS.map((d) => ({
      ...d,
      ocorrencias: d.ocorrencias!.map((o, i) => ({ ...o, key: `obj_${d.campo.toLowerCase()}_${i + 1}` })),
    }));
    const escolhas = { ...escolhasIniciais(comChave), [chaveEscolha("NomeDep", 1)]: "Fulano\nAssessor" };
    const { camposProduto, valores } = construirCamposProduto(comChave, escolhas);
    expect(camposProduto!.objetos.NomeDep[1].key).toBe("obj_nomedep_2");
    expect(valores.obj_nomedep_2).toBe("Fulano\nAssessor");
  });

  it("mantém objetos do produto anterior fora das diferenças", () => {
    const anterior = {
      arquivo: "x.cdr",
      objetos: { PartidoDep: [{ face: "Frente", x: 1, y: 1, key: "obj_partidodep_1" }] },
      campos: [{ key: "obj_partidodep_1", label: "Partido — Frente", type: "textarea" }],
    };
    const { camposProduto } = construirCamposProduto(DIFERENCAS.slice(0, 1), escolhasIniciais(DIFERENCAS), { anterior });
    expect(Object.keys(camposProduto!.objetos)).toEqual(["PartidoDep", "NomeDep"]);
  });
});

describe("formulário e prévia com campos do produto", () => {
  const { camposProduto, valores } = construirCamposProduto(
    DIFERENCAS,
    escolhasIniciais(DIFERENCAS),
  );

  it("esconde variáveis só dos objetos do produto e acrescenta os campos dele", () => {
    const keys = camposVisiveis(FORM, CAMPOS_MODELO, camposProduto).map((f) => f.key);
    // nome_deputado/anexo só existiam em NomeDep/Endereco; gabinete/email também no Contato (também do produto).
    expect(keys).not.toContain("nome_deputado");
    expect(keys).not.toContain("anexo");
    expect(keys).toContain("partido");
    expect(keys.filter((k) => k.startsWith("obj_"))).toHaveLength(5);
    expect(camposVisiveis(FORM, CAMPOS_MODELO, null)).toEqual(FORM);
  });

  it("prévia textual e ao vivo usam os campos do produto", () => {
    const tpl = camposModeloComProduto(CAMPOS_MODELO, camposProduto);
    expect(tpl.NomeDep).toMatch(/^Frente:\n\{obj_nomedep_\d\}\nVerso:\n\{obj_nomedep_\d\}$/);
    const cfg = {
      faces: [
        { elementos: [{ id: "NomeDep", template: "{nome_deputado}" }] },
        { elementos: [{ id: "NomeDep", template: "{nome_deputado}" }] },
      ],
    };
    const out = JSON.parse(previewConfigComProduto(JSON.stringify(cfg), camposProduto)!);
    const [frente, verso] = camposProduto!.objetos.NomeDep;
    expect(out.faces[0].elementos[0].template).toBe(`{${frente.key}}`);
    expect(out.faces[1].elementos[0].template).toBe(`{${verso.key}}`);
  });

  it("voltar ao modelo remove só os valores do produto", () => {
    const limpos = semValoresDoProduto({ ...valores, email: "a@b" }, camposProduto);
    expect(limpos).toEqual({ email: "a@b" });
  });
});
