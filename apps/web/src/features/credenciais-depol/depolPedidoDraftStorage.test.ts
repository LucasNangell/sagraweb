import { beforeEach, describe, expect, it } from "vitest";

import {
  DEPOL_DRAFT_STORAGE_CLIENTE,
  DEPOL_DRAFT_STORAGE_STAFF,
  clienteDepolDraftStorageKey,
  loadClienteDepolPedidoDraft,
  parseDepolPedidoDraft,
  resolveHydratedDepolDraft,
} from "./depolPedidoDraftStorage";

const sample = {
  key: "1",
  modelo_arquivo: "a.jpg",
  linha1: "A",
  linha2: "",
  linha3: "",
};

describe("parseDepolPedidoDraft", () => {
  it("retorna vazio para null/inválido", () => {
    expect(parseDepolPedidoDraft(null)).toEqual([]);
    expect(parseDepolPedidoDraft("")).toEqual([]);
    expect(parseDepolPedidoDraft("{")).toEqual([]);
    expect(parseDepolPedidoDraft("{}")).toEqual([]);
  });

  it("aceita itens válidos e ignora lixo", () => {
    const raw = JSON.stringify([
      sample,
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
      sample,
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

describe("clienteDepolDraftStorageKey", () => {
  it("escopa por id da conta", () => {
    expect(clienteDepolDraftStorageKey(12)).toBe(
      `${DEPOL_DRAFT_STORAGE_CLIENTE}.12`,
    );
    expect(clienteDepolDraftStorageKey(0)).toBe(
      `${DEPOL_DRAFT_STORAGE_CLIENTE}.0`,
    );
  });
});

describe("resolveHydratedDepolDraft", () => {
  it("prefere o rascunho remoto quando existe", () => {
    const remote = [{ ...sample, linha1: "Remoto" }];
    expect(resolveHydratedDepolDraft([sample], remote)).toEqual({
      items: remote,
      shouldPushLocalToRemote: false,
    });
  });

  it("envia o local quando o remoto está vazio", () => {
    expect(resolveHydratedDepolDraft([sample], [])).toEqual({
      items: [sample],
      shouldPushLocalToRemote: true,
    });
  });
});

describe("loadClienteDepolPedidoDraft", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("migra a chave antiga compartilhada", () => {
    localStorage.setItem(DEPOL_DRAFT_STORAGE_CLIENTE, JSON.stringify([sample]));
    const loaded = loadClienteDepolPedidoDraft(44);
    expect(loaded).toEqual([sample]);
    expect(localStorage.getItem(clienteDepolDraftStorageKey(44))).toBe(
      JSON.stringify([sample]),
    );
    expect(localStorage.getItem(DEPOL_DRAFT_STORAGE_CLIENTE)).toBeNull();
  });
});
