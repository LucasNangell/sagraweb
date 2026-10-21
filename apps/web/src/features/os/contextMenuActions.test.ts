import { describe, expect, it } from "vitest";

import type { PermissionKey } from "@/features/auth/types";

import {
  duplicateOsGerenciaSearch,
  gerenciaModalTitle,
  gerenciaSearchForModal,
  getVisibleContextMenuItems,
  isGerenciaModalExistingOnly,
  novaOsGerenciaSearch,
  type OsGerenciaModalMode,
} from "./contextMenuActions";
import type { OsSearchRow } from "./types";

const row = { nr_os: 2532, ano: 2026 };

describe("novaOsGerenciaSearch", () => {
  it("monta action=new com o tipo escolhido", () => {
    expect(novaOsGerenciaSearch("normal")).toEqual({
      action: "new",
      type: "normal",
    });
    expect(novaOsGerenciaSearch("papelaria")).toEqual({
      action: "new",
      type: "papelaria",
    });
  });
});

describe("duplicateOsGerenciaSearch", () => {
  it("monta action=duplicate com ano e id da OS", () => {
    expect(duplicateOsGerenciaSearch(row)).toEqual({
      action: "duplicate",
      ano: "2026",
      id: "2532",
    });
  });
});

describe("gerenciaSearchForModal", () => {
  it("existing usa ano/id da OS", () => {
    const mode: OsGerenciaModalMode = { kind: "existing" };
    expect(gerenciaSearchForModal(row, mode)).toEqual({
      ano: "2026",
      id: "2532",
    });
    expect(isGerenciaModalExistingOnly(mode)).toBe(true);
  });

  it("new ignora a OS aberta e usa action=new", () => {
    const mode: OsGerenciaModalMode = { kind: "new", type: "papelaria" };
    expect(gerenciaSearchForModal(row, mode)).toEqual({
      action: "new",
      type: "papelaria",
    });
    expect(isGerenciaModalExistingOnly(mode)).toBe(false);
  });

  it("duplicate usa a OS aberta como origem", () => {
    const mode: OsGerenciaModalMode = { kind: "duplicate" };
    expect(gerenciaSearchForModal(row, mode)).toEqual({
      action: "duplicate",
      ano: "2026",
      id: "2532",
    });
    expect(isGerenciaModalExistingOnly(mode)).toBe(false);
  });
});

describe("getVisibleContextMenuItems", () => {
  const osRow = { nr_os: 2532, ano: 2026 } as OsSearchRow;

  it("mostra Separador com permissão de ficha e OS selecionada", () => {
    const can = (key: PermissionKey) => key === "ctx_imprimir_ficha";
    const ids = getVisibleContextMenuItems(can, osRow).map((item) => item.id);
    expect(ids).toContain("separador");
    expect(ids).toContain("print");
  });

  it("esconde Separador sem linha ou sem permissão", () => {
    const canAll = () => true;
    expect(
      getVisibleContextMenuItems(canAll, null).some((item) => item.id === "separador"),
    ).toBe(false);

    const canNone = () => false;
    expect(
      getVisibleContextMenuItems(canNone, osRow).some(
        (item) => item.id === "separador",
      ),
    ).toBe(false);
  });
});

describe("gerenciaModalTitle", () => {
  it("segue os títulos da página Gerência", () => {
    expect(gerenciaModalTitle(row, { kind: "existing" })).toBe("OS 2532/2026");
    expect(gerenciaModalTitle(row, { kind: "new", type: "normal" })).toBe(
      "Nova Ordem de Serviço (Normal)",
    );
    expect(gerenciaModalTitle(row, { kind: "new", type: "papelaria" })).toBe(
      "Nova Ordem de Serviço (Papelaria)",
    );
    expect(gerenciaModalTitle(row, { kind: "duplicate" })).toBe(
      "Nova OS (Cópia de 2532/2026)",
    );
  });
});
