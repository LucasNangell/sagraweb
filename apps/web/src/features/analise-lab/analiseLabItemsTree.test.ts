import { describe, expect, it } from "vitest";

import type { AnaliseLabItem } from "@/api/analiseLab";
import type { OsVersionItem } from "@/features/analise/types";

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

const versions: OsVersionItem[] = [
  { version: 1, label: "v1 (Original)", path: "C:/os/v1" },
  { version: 2, label: "v2 (Original)", path: "C:/os/v2" },
  { version: 3, label: "v3 (Original)", path: "C:/os/v3" },
];

describe("analiseLabItemsTree", () => {
  it("groups by version and component without OS versions", () => {
    const tree = buildLabItemsTree(items, "v2");
    expect(tree[0].label).toBe("v2");
    expect(tree[0].readonly).toBe(false);
    expect(tree.find((v) => v.label === "v1")?.readonly).toBe(true);
    const capa = tree[0].components.find((c) => c.label === "Capa");
    expect(capa?.items.map((i) => i.id)).toEqual([1]);
  });

  it("shows all OS versions including empty ones", () => {
    const tree = buildLabItemsTree(items, "v2 (Original)", versions);
    expect(tree.map((v) => v.label)).toEqual([
      "v2 (Original)",
      "v1 (Original)",
      "v3 (Original)",
    ]);
    expect(tree.find((v) => v.label === "v3 (Original)")?.itemCount).toBe(0);
    expect(tree.find((v) => v.label === "v3 (Original)")?.readonly).toBe(true);
  });

  it("matches fuzzy version labels like Análise", () => {
    const tree = buildLabItemsTree(items, "v2", versions);
    const v2 = tree.find((v) => v.key === "v2");
    expect(v2?.readonly).toBe(false);
    expect(v2?.itemCount).toBe(2);
    expect(v2?.components.find((c) => c.label === "Capa")?.items.map((i) => i.id)).toEqual([
      1,
    ]);
  });

  it("attaches classified PDF files to component slots", () => {
    const tree = buildLabItemsTree(
      items,
      "v2 (Original)",
      versions,
      {
        v2: [
          { name: "capa.pdf", path: "C:/os/v2/capa.pdf", pages: 2 },
          { name: "miolo.pdf", path: "C:/os/v2/miolo.pdf", pages: 40 },
        ],
        v3: [],
      },
      "Revista",
    );
    const v2 = tree.find((v) => v.key === "v2");
    const capa = v2?.components.find((c) => c.label === "Capa");
    expect(capa?.versionFile?.name).toBe("capa.pdf");
    expect(capa?.versionFile?.ausente).toBeFalsy();
    const miolo = v2?.components.find((c) => c.label === "Miolo");
    expect(miolo?.versionFile?.name).toBe("miolo.pdf");
  });

  it("keeps orphan items with unknown version labels", () => {
    const withOrphan: AnaliseLabItem[] = [
      ...items,
      {
        id: 9,
        sessaoId: 1,
        titulo: "Órfão",
        htmlSnapshot: "",
        componente: "Arq. Único",
        escopo: "pagina",
        pagina: 1,
        versaoLabel: "legado-x",
        ordem: 1,
      },
    ];
    const tree = buildLabItemsTree(withOrphan, "v2 (Original)", versions);
    expect(tree.find((v) => v.label === "legado-x")?.itemCount).toBe(1);
  });

  it("detects readonly versions", () => {
    expect(isLabVersionReadOnly("v1", "v2")).toBe(true);
    expect(isLabVersionReadOnly("v2", "v2")).toBe(false);
    expect(isLabVersionReadOnly("v1 (Original)", "v2", versions)).toBe(true);
    expect(isLabVersionReadOnly("v2", "v2 (Original)", versions)).toBe(false);
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
