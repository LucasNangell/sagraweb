import { describe, expect, it } from "vitest";

import {
  DEPOL_DRAFT_STORAGE_CLIENTE,
  DEPOL_DRAFT_STORAGE_STAFF,
  parseDepolPedidoDraft,
} from "./depolPedidoDraftStorage";

describe("parseDepolPedidoDraft", () => {
  it("retorna vazio para null/inválido", () => {
    expect(parseDepolPedidoDraft(null)).toEqual([]);
    expect(parseDepolPedidoDraft("")).toEqual([]);
    expect(parseDepolPedidoDraft("{")).toEqual([]);
    expect(parseDepolPedidoDraft("{}")).toEqual([]);
  });

  it("aceita itens válidos e ignora lixo", () => {
    const raw = JSON.stringify([
      {
        key: "1",
        modelo_arquivo: "a.jpg",
        linha1: "A",
        linha2: "",
        linha3: "",
      },
      { key: 2, modelo_arquivo: "x" },
      {
        key: "2",
        modelo_arquivo: "b.jpg",
        linha1: "B",
        linha2: "C",
        linha3: "D",
      },
    ]);
    expect(parseDepolPedidoDraft(raw)).toEqual([
      {
        key: "1",
        modelo_arquivo: "a.jpg",
        linha1: "A",
        linha2: "",
        linha3: "",
      },
      {
        key: "2",
        modelo_arquivo: "b.jpg",
        linha1: "B",
        linha2: "C",
        linha3: "D",
      },
    ]);
  });

  it("chaves staff e cliente são distintas", () => {
    expect(DEPOL_DRAFT_STORAGE_STAFF).toContain("staff");
    expect(DEPOL_DRAFT_STORAGE_CLIENTE).toContain("cliente");
    expect(DEPOL_DRAFT_STORAGE_STAFF).not.toBe(DEPOL_DRAFT_STORAGE_CLIENTE);
  });
});
