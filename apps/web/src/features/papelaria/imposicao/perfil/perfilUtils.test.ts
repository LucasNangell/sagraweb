import { describe, expect, it } from "vitest";

import {
  converterParaManual,
  gerarSlotsPelaGrade,
  parsePerfilJson,
  perfilVazio,
  problemasDeSlots,
  resolverSlots,
  resumoPerfil,
} from "./perfilUtils";
import type { PerfilImposicao } from "./types";

function a5Duplo(): PerfilImposicao {
  const p = perfilVazio();
  p.folha = { largura_mm: 297, altura_mm: 210 };
  p.pagina = { fonte: "fixa", largura_mm: 148, altura_mm: 210 };
  p.grade = { colunas: 2, linhas: 1, espaco_h_mm: 0, espaco_v_mm: 0, alinhamento: "centro" };
  p.slots.frente = gerarSlotsPelaGrade(p);
  return p;
}

describe("perfilUtils", () => {
  it("resolve a grade com a mesma conta do gerador de JDF (topo-esquerdo)", () => {
    const slots = resolverSlots(a5Duplo());
    expect(slots.map((s) => [s.x_mm, s.y_mm])).toEqual([
      [0.5, 0],
      [148.5, 0],
    ]);
    expect(slots[0]).toMatchObject({ largura_mm: 148, altura_mm: 210 });
  });

  it("grade sem centralizar encosta no topo esquerdo, com espaços", () => {
    const p = perfilVazio();
    p.folha = { largura_mm: 320, altura_mm: 450 };
    p.pagina = { fonte: "fixa", largura_mm: 55, altura_mm: 90 };
    p.grade = { colunas: 2, linhas: 2, espaco_h_mm: 3, espaco_v_mm: 4, alinhamento: "topo_esquerda" };
    p.slots.frente = gerarSlotsPelaGrade(p);
    const s = resolverSlots(p);
    expect(s.map((x) => [x.x_mm, x.y_mm])).toEqual([
      [0, 0],
      [58, 0],
      [0, 94],
      [58, 94],
    ]);
  });

  it("rotação de 90° troca largura e altura ocupadas", () => {
    const p = perfilVazio();
    p.folha = { largura_mm: 400, altura_mm: 300 };
    p.pagina = { fonte: "fixa", largura_mm: 100, altura_mm: 50 };
    p.posicionamento = "manual";
    p.slots.frente = [{ id: 1, x_mm: 10, y_mm: 20, rotacao: 90, pagina: 1 }];
    expect(resolverSlots(p)[0]).toMatchObject({ x_mm: 10, y_mm: 20, largura_mm: 50, altura_mm: 100 });
  });

  it("converter para manual preserva as posições calculadas", () => {
    const manual = converterParaManual(a5Duplo());
    expect(manual.posicionamento).toBe("manual");
    expect(manual.slots.frente.map((s) => [s.x_mm, s.y_mm])).toEqual([
      [0.5, 0],
      [148.5, 0],
    ]);
    expect(resolverSlots(manual)).toEqual(resolverSlots(a5Duplo()));
  });

  it("aponta slot fora da folha e sobreposição", () => {
    const p = perfilVazio();
    p.folha = { largura_mm: 300, altura_mm: 200 };
    p.pagina = { fonte: "fixa", largura_mm: 100, altura_mm: 100 };
    p.posicionamento = "manual";
    p.slots.frente = [
      { id: 1, x_mm: 0, y_mm: 0, rotacao: 0, pagina: 1 },
      { id: 2, x_mm: 50, y_mm: 50, rotacao: 0, pagina: 1 },
      { id: 3, x_mm: 250, y_mm: 0, rotacao: 0, pagina: 1 },
    ];
    const probs = problemasDeSlots(p, "frente");
    expect(probs.get(1)).toBe("sobrepoe");
    expect(probs.get(2)).toBe("sobrepoe");
    expect(probs.get(3)).toBe("fora");
  });

  it("sangria conta para fora da folha", () => {
    const p = a5Duplo();
    p.sangria_mm = 3;
    expect(problemasDeSlots(p, "frente").get(1)).toBe("fora");
  });

  it("resumo de uma linha", () => {
    const p = a5Duplo();
    p.marcas = { ativo: true, pdf_path: "x.pdf", carimbar_op: false };
    expect(resumoPerfil(p)).toBe("297×210 mm · 2 slots · marcas ✓");
  });

  it("importação aceita só v2 e completa campos faltantes", () => {
    expect(() => parsePerfilJson(JSON.stringify({ folha_mm: { largura: 1 } }))).toThrow(/versao/);
    const p = parsePerfilJson(JSON.stringify({ versao: 2, folha: { largura_mm: 100, altura_mm: 50 } }));
    expect(p.folha).toEqual({ largura_mm: 100, altura_mm: 50 });
    expect(p.juntada.regra_tiragem).toBe("iguais");
  });
});
