import { describe, expect, it } from "vitest";

import type { AnaliseLabItem } from "@/api/analiseLab";

import {
  buildLabItemsTree,
  canDropLabItem,
  isLabVersionReadOnly,
  reorderIdsAfterDrop,
} from "./analiseLabItemsTree";

const items: AnaliseLabItem[] = [
  {
    id: 1,
    sessaoId: 1,
    titulo: "A",
    htmlSnapshot: "",
    componente: "Capa",
    escopo: "pagina",
    pagina: 1,
    versaoLabel: "v2",
    ordem: 2,
  },
  {
    id: 2,
    sessaoId: 1,
    titulo: "B",
    htmlSnapshot: "",
    componente: "Miolo",
    escopo: "pagina",
    pagina: 2,
    versaoLabel: "v2",
    ordem: 1,
  },
  {
    id: 3,
    sessaoId: 1,
    titulo: "C",
    htmlSnapshot: "",
    componente: "Miolo",
    escopo: "pagina",
    pagina: 3,
    versaoLabel: "v1",
    ordem: 1,
  },
];

describe("analiseLabItemsTree", () => {
  it("groups by version and component", () => {
    const tree = buildLabItemsTree(items, "v2");
    expect(tree[0].label).toBe("v2");
    expect(tree[0].readonly).toBe(false);
    expect(tree.find((v) => v.label === "v1")?.readonly).toBe(true);
    const capa = tree[0].components.find((c) => c.label === "Capa");
    expect(capa?.items.map((i) => i.id)).toEqual([1]);
  });

  it("detects readonly versions", () => {
    expect(isLabVersionReadOnly("v1", "v2")).toBe(true);
    expect(isLabVersionReadOnly("v2", "v2")).toBe(false);
  });

  it("allows drop only in same writable version", () => {
    expect(
      canDropLabItem({
        sourceVersao: "v2",
        sourceComponente: "Capa",
        targetVersao: "v2",
        targetComponente: "Miolo",
      }),
    ).toBe(true);
    expect(
      canDropLabItem({
        sourceVersao: "v1",
        sourceComponente: "Miolo",
        targetVersao: "v2",
        targetComponente: "Miolo",
      }),
    ).toBe(false);
    expect(
      canDropLabItem({
        sourceVersao: "v2",
        sourceComponente: "Capa",
        targetVersao: "v2",
        targetComponente: "Miolo",
        readonlySource: true,
      }),
    ).toBe(false);
  });

  it("reorders ids after drop", () => {
    expect(
      reorderIdsAfterDrop({
        componentItemIds: [1, 2, 3],
        draggedId: 3,
        overItemId: 1,
        targetIsComponent: false,
      }),
    ).toEqual([3, 1, 2]);
    expect(
      reorderIdsAfterDrop({
        componentItemIds: [1, 2],
        draggedId: 9,
        overItemId: null,
        targetIsComponent: true,
      }),
    ).toEqual([1, 2, 9]);
  });
});
