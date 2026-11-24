import { describe, expect, it } from "vitest";

import {
  isHistorySelectionAdditive,
  nextHistorySelectionKeys,
  nextHistorySelectionRows,
  rangeHistorySelectionKeys,
  resolveHistorySelectionMode,
  sortHistoryRowsNewestFirst,
} from "./osHistoryMultiselect";

describe("resolveHistorySelectionMode", () => {
  it("prioriza Shift sobre Ctrl", () => {
    expect(
      resolveHistorySelectionMode({
        ctrlKey: true,
        metaKey: false,
        shiftKey: true,
      }),
    ).toBe("range");
  });

  it("usa toggle com Ctrl/Meta e replace sem modificador", () => {
    expect(
      resolveHistorySelectionMode({
        ctrlKey: true,
        metaKey: false,
        shiftKey: false,
      }),
    ).toBe("toggle");
    expect(
      resolveHistorySelectionMode({
        ctrlKey: false,
        metaKey: true,
        shiftKey: false,
      }),
    ).toBe("toggle");
    expect(
      resolveHistorySelectionMode({
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
      }),
    ).toBe("replace");
  });
});

describe("nextHistorySelectionKeys", () => {
  it("substitui a seleção sem modificador", () => {
    expect(nextHistorySelectionKeys(["a", "b"], "c", false)).toEqual(["c"]);
  });

  it("adiciona a linha com Ctrl quando ainda não estava marcada", () => {
    expect(nextHistorySelectionKeys(["a"], "b", true)).toEqual(["a", "b"]);
  });

  it("remove a linha com Ctrl quando já estava marcada", () => {
    expect(nextHistorySelectionKeys(["a", "b"], "a", true)).toEqual(["b"]);
  });

  it("pode deixar a seleção vazia ao desmarcar a única linha com Ctrl", () => {
    expect(nextHistorySelectionKeys(["a"], "a", true)).toEqual([]);
  });
});

describe("rangeHistorySelectionKeys", () => {
  const all = ["a", "b", "c", "d", "e"];

  it("seleciona o intervalo inclusivo entre âncora e clique", () => {
    expect(rangeHistorySelectionKeys(all, "b", "d")).toEqual(["b", "c", "d"]);
    expect(rangeHistorySelectionKeys(all, "d", "b")).toEqual(["b", "c", "d"]);
  });

  it("usa só o clique quando não há âncora válida", () => {
    expect(rangeHistorySelectionKeys(all, null, "c")).toEqual(["c"]);
    expect(rangeHistorySelectionKeys(all, "missing", "c")).toEqual(["c"]);
  });
});

describe("nextHistorySelectionRows", () => {
  const getKey = (row: { id: string }) => row.id;
  const all = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];

  it("substitui as linhas no modo replace e atualiza a âncora", () => {
    expect(
      nextHistorySelectionRows([{ id: "a" }], { id: "b" }, getKey, "replace"),
    ).toEqual({ rows: [{ id: "b" }], nextAnchorKey: "b" });
  });

  it("adiciona ou remove no modo toggle sem mover a âncora", () => {
    expect(
      nextHistorySelectionRows([{ id: "a" }], { id: "b" }, getKey, "toggle", {
        anchorKey: "a",
      }),
    ).toEqual({ rows: [{ id: "a" }, { id: "b" }], nextAnchorKey: "a" });
  });

  it("seleciona o intervalo no modo range", () => {
    expect(
      nextHistorySelectionRows([{ id: "a" }], { id: "c" }, getKey, "range", {
        allRows: all,
        anchorKey: "a",
      }),
    ).toEqual({
      rows: [{ id: "a" }, { id: "b" }, { id: "c" }],
      nextAnchorKey: "a",
    });
  });
});

describe("sortHistoryRowsNewestFirst", () => {
  it("ordena pela posição na lista (mais novo = último)", () => {
    const all = [{ id: "old" }, { id: "mid" }, { id: "new" }];
    expect(
      sortHistoryRowsNewestFirst(
        [{ id: "old" }, { id: "new" }, { id: "mid" }],
        all,
        (row) => row.id,
      ),
    ).toEqual([{ id: "new" }, { id: "mid" }, { id: "old" }]);
  });
});

describe("isHistorySelectionAdditive", () => {
  it("é aditivo com Ctrl ou Meta", () => {
    expect(isHistorySelectionAdditive({ ctrlKey: true, metaKey: false })).toBe(
      true,
    );
    expect(isHistorySelectionAdditive({ ctrlKey: false, metaKey: true })).toBe(
      true,
    );
    expect(isHistorySelectionAdditive({ ctrlKey: false, metaKey: false })).toBe(
      false,
    );
  });
});
