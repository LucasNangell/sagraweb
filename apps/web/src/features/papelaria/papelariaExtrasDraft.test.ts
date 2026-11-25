import { beforeEach, describe, expect, it } from "vitest";

import {
  clearExtrasDraft,
  extrasDraftKey,
  extrasDeInternos,
  loadExtrasDraft,
  saveExtrasDraft,
} from "./papelariaExtrasDraft";
import type { CampoExtra } from "./papelariaCamposExtras";

const extra: CampoExtra = {
  id: "extra_1",
  tipo: "texto",
  ancora_chave: "7:1:NOME",
  direcao: "abaixo",
  texto: "Cargo",
  rede_chave: "",
  rede_valor: "",
  redes: [],
  estilo: null,
  icone_pt: null,
  x_pt: 10,
  y_pt: 20,
  offset_x_pt: 0,
  offset_y_pt: 0,
  align_h: "esquerda",
  align_v: "topo",
  tamanho_pt: 12,
  negrito: [],
};

describe("papelariaExtrasDraft", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("grava e recarrega por OS", () => {
    expect(extrasDraftKey(2026, 5123)).toBe("sagra_papelaria_extras_draft:2026:5123");
    saveExtrasDraft(2026, 5123, [extra], {
      "7:1:NOME": { tamanho_pt: 14, align_h: "centro", align_v: "topo" },
    });
    const loaded = loadExtrasDraft(2026, 5123);
    expect(loaded?.extras).toHaveLength(1);
    expect(loaded?.extras[0]?.texto).toBe("Cargo");
    expect(loaded?.estilos["7:1:NOME"]?.tamanho_pt).toBe(14);
    expect(loadExtrasDraft(2026, 9999)).toBeNull();
  });

  it("lista vazia remove a chave", () => {
    saveExtrasDraft(2026, 1, [extra], {});
    expect(loadExtrasDraft(2026, 1)).not.toBeNull();
    saveExtrasDraft(2026, 1, [], {});
    expect(loadExtrasDraft(2026, 1)).toBeNull();
    clearExtrasDraft(2026, 1);
  });

  it("extrasDeInternos lê __campos_extras e __campos_estilo", () => {
    const r = extrasDeInternos({
      __campos_extras: JSON.stringify([
        {
          id: "extra_1",
          tipo: "rede",
          ancora_chave: "7:1:NOME",
          direcao: "direita",
          rede_chave: "instagram",
          rede_valor: "@ana",
        },
      ]),
      __campos_estilo: JSON.stringify({ "7:1:NOME": { tamanho_pt: 11 } }),
    });
    expect(r.extras).toHaveLength(1);
    expect(r.extras[0]?.rede_chave).toBe("instagram");
    expect(r.estilos["7:1:NOME"]?.tamanho_pt).toBe(11);
    expect(extrasDeInternos(null)).toEqual({ extras: [], estilos: {} });
  });
});
