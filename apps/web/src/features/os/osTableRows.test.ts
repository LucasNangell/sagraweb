import { describe, expect, it } from "vitest";

import {
  isSameOsSelection,
  normalizeOsSelection,
  selectionRowKey,
  toMainOsSelection,
} from "./osTableRows";
import type { OsSearchRow } from "./types";

const mainRow: OsSearchRow = {
  nr_os: 2532,
  ano: 2026,
  situacao: "Em Execução",
};

const subRow: OsSearchRow = {
  nr_os: 2532,
  ano: 2026,
  kind: "sub_os",
  is_sub_os: true,
  sub_os_id: 7,
  componente_id: 10,
  componente_nome: "Capa",
  display_label: "2532 [Capa]",
  parent_nr_os: 2532,
  parent_ano: 2026,
  situacao: "Em Execução",
};

describe("selectionRowKey", () => {
  it("diferencia OS principal e Sub OS do mesmo protocolo", () => {
    expect(selectionRowKey(mainRow)).toBe("main:2026:2532");
    expect(selectionRowKey(subRow)).toBe("sub:2026:2532:7");
    expect(selectionRowKey(mainRow)).not.toBe(selectionRowKey(subRow));
  });

  it("isSameOsSelection usa chave estável", () => {
    expect(isSameOsSelection(subRow, { ...subRow, titulo: "outro" })).toBe(true);
    expect(isSameOsSelection(mainRow, subRow)).toBe(false);
  });
});

describe("normalizeOsSelection", () => {
  it("marca Sub OS com kind e campos do pai", () => {
    const normalized = normalizeOsSelection(subRow);
    expect(normalized.kind).toBe("sub_os");
    expect(normalized.parent_nr_os).toBe(2532);
    expect(normalized.sub_os_id).toBe(7);
  });

  it("marca OS principal com kind main_os", () => {
    const normalized = normalizeOsSelection(mainRow);
    expect(normalized.kind).toBe("main_os");
    expect(normalized.is_sub_os).toBeUndefined();
  });
});

describe("toMainOsSelection", () => {
  it("remove flags de Sub OS e restaura nr_os/ano principal", () => {
    const main = toMainOsSelection(subRow);
    expect(main.kind).toBe("main_os");
    expect(main.is_sub_os).toBeUndefined();
    expect(main.sub_os_id).toBeUndefined();
    expect(main.nr_os).toBe(2532);
    expect(main.ano).toBe(2026);
    expect(main.situacao).toBe("Em Execução");
  });
});
